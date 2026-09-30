import { type Anonymizer, applyPlaceholders, entityCounts } from "@app/anonymization";
import {
  AgreementAggregate,
  AuditRunAggregate,
  agreements,
  agreementTexts,
  auditRunPrompts,
  auditRuns,
  type Database,
  events,
  executeCommand,
  type FileStorage,
  type Job,
  loadAggregate,
  loadAnonymizationSetting,
  requestAudit,
  ruleVersions,
  type StoredAnonymization,
} from "@app/db";
import { AppError, type AuditModelConfig, type EventMetadata, type PromptRule, type Severity, sha256Hex } from "@app/domain";
import { detectLanguage, ExtractionError, extractText, segmentSections } from "@app/extraction";
import { type AuditModelClient, type ResolvedAuditModel, runAuditEngine, type VotingOptions } from "@app/llm";
import { and, eq, or, sql } from "drizzle-orm";
import type { JobHandler } from "./worker.ts";

/** Worker events carry the correlation id of the request that caused the job. */
async function metaForJob(database: Database, job: Job): Promise<EventMetadata> {
  let correlationId = `job:${job.id}`;
  if (job.sourceEventId) {
    const [src] = await database.db.select({ metadata: events.metadata }).from(events).where(eq(events.eventId, job.sourceEventId));
    const m = src?.metadata as { correlationId?: string } | undefined;
    if (m?.correlationId) correlationId = m.correlationId;
  }
  return {
    actorUserId: null,
    actorType: "worker",
    correlationId,
    causationId: job.sourceEventId,
    requestId: null,
    ip: null,
    userAgent: null,
  };
}

const isConflict = (err: unknown) => err instanceof AppError && err.code === "CONFLICT";
const isLastAttempt = (job: Job) => job.attempts >= job.maxAttempts;

type Tx = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

/** Anonymizes the text with the admin's current settings; the caller stores the result. Nothing is stored or sent when the service fails. */
async function anonymizeFor(database: Database, anonymizer: Anonymizer, text: string, language: "pl" | "en") {
  const { config } = await loadAnonymizationSetting(database.db);
  const out = await anonymizer.anonymize(text, { language, config });
  const anonymization: StoredAnonymization = { engine: out.engine, language: out.language, entities: out.entities };
  return { anonymizedText: out.text, anonymization };
}

async function recordAnonymization(tx: Tx, agreementId: string, anonymizedText: string, a: StoredAnonymization, meta: EventMetadata) {
  await executeCommand(
    tx,
    AgreementAggregate,
    agreementId,
    {
      type: "RecordAnonymization",
      engine: a.engine,
      language: a.language,
      entityCounts: entityCounts(a.entities),
      entityTotal: a.entities.length,
      anonymizedSha256: sha256Hex(anonymizedText),
    },
    meta,
    { tx },
  );
}

/**
 * Extracts the text, then requests an audit with the current model so an upload
 * flows to a report without a click. No applicable rules is not an error: the
 * agreement stays "text ready" and an auditor can run it later.
 */
export function extractTextHandler(
  storage: FileStorage,
  auditModel: () => Promise<ResolvedAuditModel>,
  anonymizer: Anonymizer | null = null,
): JobHandler {
  return async (job, { database }) => {
    const { agreementId } = job.payload as { agreementId: string };
    const [a] = await database.db.select().from(agreements).where(eq(agreements.id, agreementId));
    if (!a) throw new Error(`Agreement ${agreementId} not found`);
    const meta = await metaForJob(database, job);
    const bytes = await storage.get(a.storageKey);
    try {
      const out = await extractText(bytes, a.format);
      const language = detectLanguage(out.text);
      let anonymized: Awaited<ReturnType<typeof anonymizeFor>> | null = null;
      if (anonymizer) {
        try {
          anonymized = await anonymizeFor(database, anonymizer, out.text, language);
        } catch (err) {
          // Retried by the worker; after the last attempt the agreement is marked failed and nothing reaches a model.
          if (!isLastAttempt(job)) throw err;
          await executeCommand(
            database.db,
            AgreementAggregate,
            agreementId,
            {
              type: "RecordExtractionFailure",
              reason: "anonymization_failed",
              message: `${err instanceof Error ? err.message : String(err)} The text was not sent to any model; upload the file again once the anonymizer runs.`,
            },
            meta,
          );
          return;
        }
      }
      await database.db.transaction(async (tx) => {
        const textSha256 = sha256Hex(out.text);
        const row = {
          text: out.text,
          textSha256,
          extractor: out.extractor,
          language,
          anonymizedText: anonymized?.anonymizedText ?? null,
          anonymization: anonymized?.anonymization ?? null,
        };
        await tx
          .insert(agreementTexts)
          .values({ agreementId, ...row })
          .onConflictDoUpdate({ target: agreementTexts.agreementId, set: row });
        await executeCommand(
          database.db,
          AgreementAggregate,
          agreementId,
          {
            type: "RecordExtraction",
            extractor: out.extractor,
            charCount: out.text.length,
            pageCount: out.pageCount,
            textSha256,
            sectionCount: segmentSections(out.text).length,
            language,
          },
          meta,
          { tx },
        );
        if (anonymized) await recordAnonymization(tx, agreementId, anonymized.anonymizedText, anonymized.anonymization, meta);
      });
      const resolved = await auditModel();
      try {
        await requestAudit(database.db, {
          agreementId,
          agreementType: a.agreementType,
          agreementLanguage: language,
          model: { label: resolved.label, config: { provider: resolved.provider, model: resolved.model, reasoning: resolved.reasoning } },
          meta,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
        console.info(`[worker] no audit for ${agreementId}: ${(err as AppError).message}`);
      }
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      await executeCommand(
        database.db,
        AgreementAggregate,
        agreementId,
        { type: "RecordExtractionFailure", reason: err.reason, message: err.message },
        meta,
      );
    }
  };
}

export async function loadRuleSnapshot(database: Database, snapshot: { ruleId: string; version: number }[]): Promise<PromptRule[]> {
  const rows = await database.db
    .select()
    .from(ruleVersions)
    .where(or(...snapshot.map((s) => and(eq(ruleVersions.ruleId, s.ruleId), eq(ruleVersions.contentVersion, s.version)))));
  return snapshot.map((s) => {
    const r = rows.find((x) => x.ruleId === s.ruleId && x.contentVersion === s.version);
    if (!r) throw new Error(`Rule ${s.ruleId} version ${s.version} is missing`);
    return {
      id: r.ruleId,
      version: r.contentVersion,
      slug: r.slug,
      title: r.title,
      description: r.description,
      severity: r.severity as Severity,
      category: r.category,
    };
  });
}

/** Builds the client for the model recorded on the run; null means the run predates that record, so use the current setting. */
export type ClientResolver = (config: AuditModelConfig | null) => Promise<AuditModelClient>;

export function runAuditHandler(
  clientFor: ClientResolver,
  opts: { timeoutMs?: number; voting?: VotingOptions; anonymizer?: Anonymizer | null } = {},
): JobHandler {
  return async (job, { database, workerId }) => {
    const { runId } = job.payload as { runId: string };
    const meta = await metaForJob(database, job);
    const exec = (cmd: Parameters<typeof executeCommand<unknown, Parameters<typeof AuditRunAggregate.decide>[1]>>[3]) =>
      executeCommand(database.db, AuditRunAggregate, runId, cmd, meta);

    const [run] = await database.db.select().from(auditRuns).where(eq(auditRuns.id, runId));
    const [agreement] = run ? await database.db.select().from(agreements).where(eq(agreements.id, run.agreementId)) : [];
    let [text] = agreement ? await database.db.select().from(agreementTexts).where(eq(agreementTexts.agreementId, agreement.id)) : [];

    // Agreements extracted before anonymization was switched on are anonymized now, before the run starts,
    // so a failed attempt can be retried without leaving the run stuck in "running".
    let anonymizationError: string | null = null;
    if (opts.anonymizer && agreement && text && text.anonymizedText === null && run?.status === "requested") {
      try {
        const done = await anonymizeFor(database, opts.anonymizer, text.text, text.language ?? detectLanguage(text.text));
        await database.db.transaction(async (tx) => {
          await tx.update(agreementTexts).set(done).where(eq(agreementTexts.agreementId, agreement.id));
          await recordAnonymization(tx, agreement.id, done.anonymizedText, done.anonymization, meta);
        });
        text = { ...text, ...done };
      } catch (err) {
        if (!isLastAttempt(job)) throw err;
        anonymizationError = err instanceof Error ? err.message : String(err);
      }
    }

    try {
      await exec({ type: "StartAudit", workerId });
    } catch (err) {
      if (isConflict(err)) return; // cancelled or already finished
      throw err;
    }
    if (!run || !agreement || !text) {
      await exec({ type: "FailAudit", reason: "The agreement text is not available. Re-run extraction first.", retryable: false });
      return;
    }
    if (anonymizationError) {
      await exec({
        type: "FailAudit",
        reason: `Anonymization failed, so nothing was sent to the model: ${anonymizationError}`,
        retryable: true,
      });
      return;
    }
    const client = await clientFor((await loadAggregate(database.db, AuditRunAggregate, runId)).state.modelConfig);
    // Once anonymized, an agreement is always audited in its anonymized form, even if the anonymizer is later switched off.
    const entities = text.anonymization?.entities ?? [];
    const promptText = text.anonymizedText ?? text.text;
    const title = applyPlaceholders(agreement.title, entities);
    const rules = await loadRuleSnapshot(database, run.ruleSnapshot);
    // Attempts continue numbering across retries of the same run.
    const [{ offset }] = (await database.db
      .select({ offset: sql<number>`coalesce(max(${auditRunPrompts.attemptNo}), 0)::int` })
      .from(auditRunPrompts)
      .where(eq(auditRunPrompts.runId, runId))) as [{ offset: number }];

    const result = await runAuditEngine({
      client,
      agreement: {
        title,
        type: agreement.agreementType,
        sections: segmentSections(promptText),
        fileName: agreement.fileName,
      },
      rules,
      timeoutMs: opts.timeoutMs,
      voting: opts.voting,
      hooks: {
        beforeCall: async ({ attemptNo, systemPrompt, prompt, promptSha256, purpose }) => {
          const { state } = await loadAggregate(database.db, AuditRunAggregate, runId);
          if (state.status !== "running") return false;
          await database.db
            .insert(auditRunPrompts)
            .values({ runId, attemptNo: offset + attemptNo, model: client.label, systemPrompt, prompt, promptSha256 });
          await exec({
            type: "RecordClaudeCall",
            model: client.label,
            promptSha256,
            promptChars: systemPrompt.length + prompt.length,
            purpose,
          });
          return true;
        },
        afterCall: async ({ attemptNo, result }) => {
          await database.db
            .update(auditRunPrompts)
            .set({ rawResponse: (result.raw ?? null) as never })
            .where(and(eq(auditRunPrompts.runId, runId), eq(auditRunPrompts.attemptNo, offset + attemptNo)));
          await exec({
            type: "RecordClaudeResponse",
            attemptNo: offset + attemptNo,
            ok: result.ok,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cacheReadTokens: result.cacheReadTokens,
            cacheWriteTokens: result.cacheWriteTokens,
            numTurns: result.numTurns,
            model: result.model,
            sessionId: result.sessionId,
            error: result.error,
          });
        },
        onRejected: async ({ attemptNo, errors }) => {
          await exec({ type: "RejectOutput", attemptNo: offset + attemptNo, validationErrors: errors });
        },
        onVoted: async ({ mode, samples, outcomes }) => {
          await exec({ type: "RecordVote", mode, samples, rules: outcomes });
        },
      },
    }).catch(async (err) => {
      if (isConflict(err)) return null; // cancelled mid-run
      throw err;
    });
    if (!result) return;

    try {
      if (result.ok) {
        await exec({
          type: "CompleteAudit",
          verdict: result.verdict,
          summary: result.summary,
          findings: result.findings,
          agreementMetadata: result.agreementMetadata,
        });
      } else if (!result.stopped) {
        await exec({ type: "FailAudit", reason: result.reason, retryable: result.retryable });
      }
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  };
}
