import type { StoredEvent } from "@app/domain";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client.ts";
import { agreements, auditRuns, rules, ruleVersions } from "../schema.ts";

export async function projectRules(tx: Tx, e: StoredEvent): Promise<void> {
  if (e.streamType !== "Rule") return;
  const at = e.occurredAt;
  switch (e.type) {
    case "RuleCreated": {
      const { slug, title, description, severity, category, appliesTo, languages } = e.payload;
      await tx.insert(rules).values({
        id: e.streamId,
        slug,
        title,
        description,
        severity,
        category,
        appliesTo,
        languages,
        status: "active",
        version: e.streamVersion,
        contentVersion: 1,
        createdAt: at,
        updatedAt: at,
      });
      await tx.insert(ruleVersions).values({
        ruleId: e.streamId,
        contentVersion: 1,
        slug,
        title,
        description,
        severity,
        category,
        appliesTo,
        languages,
        createdAt: at,
      });
      return;
    }
    case "RuleUpdated": {
      const { title, description, severity, category, appliesTo, languages } = e.payload;
      const [r] = await tx
        .update(rules)
        .set({
          title,
          description,
          severity,
          category,
          appliesTo,
          languages,
          version: e.streamVersion,
          contentVersion: sql`${rules.contentVersion} + 1`,
          updatedAt: at,
        })
        .where(eq(rules.id, e.streamId))
        .returning({ contentVersion: rules.contentVersion, slug: rules.slug });
      await tx.insert(ruleVersions).values({
        ruleId: e.streamId,
        contentVersion: r!.contentVersion,
        slug: r!.slug,
        title,
        description,
        severity,
        category,
        appliesTo,
        languages,
        createdAt: at,
      });
      return;
    }
    case "RuleArchived":
    case "RuleRestored":
      await tx
        .update(rules)
        .set({ status: e.type === "RuleArchived" ? "archived" : "active", version: e.streamVersion, updatedAt: at })
        .where(eq(rules.id, e.streamId));
      return;
    default:
      // Read events leave the rule and its version untouched.
      return;
  }
}

export async function projectAgreements(tx: Tx, e: StoredEvent): Promise<void> {
  if (e.streamType !== "Agreement") return;
  const at = e.occurredAt;
  const bump = { version: e.streamVersion, updatedAt: at };
  switch (e.type) {
    case "AgreementUploaded":
      await tx.insert(agreements).values({
        id: e.streamId,
        title: e.payload.title,
        fileName: e.payload.fileName,
        format: e.payload.format,
        mimeType: e.payload.mimeType,
        sizeBytes: e.payload.sizeBytes,
        storageKey: e.payload.storageKey,
        sha256: e.payload.sha256,
        agreementType: e.payload.agreementType,
        extractionStatus: "pending",
        uploadedBy: e.metadata.actorUserId,
        version: e.streamVersion,
        createdAt: at,
        updatedAt: at,
      });
      return;
    case "AgreementTextExtracted":
      await tx
        .update(agreements)
        .set({
          extractionStatus: "extracted",
          extractionError: null,
          charCount: e.payload.charCount,
          pageCount: e.payload.pageCount,
          language: e.payload.language ?? null,
          anonymizedEntityCount: null,
          ...bump,
        })
        .where(eq(agreements.id, e.streamId));
      return;
    case "AgreementAnonymized":
      await tx
        .update(agreements)
        .set({ language: e.payload.language, anonymizedEntityCount: e.payload.entityTotal, ...bump })
        .where(eq(agreements.id, e.streamId));
      return;
    case "AgreementTextExtractionFailed":
      await tx
        .update(agreements)
        .set({ extractionStatus: "failed", extractionError: `${e.payload.reason}: ${e.payload.message}`, ...bump })
        .where(eq(agreements.id, e.streamId));
      return;
    default:
      return;
  }
}

async function syncAgreementLatest(tx: Tx, runId: string) {
  const [run] = await tx.select().from(auditRuns).where(eq(auditRuns.id, runId));
  if (!run) return;
  const [latest] = await tx
    .select({ id: auditRuns.id })
    .from(auditRuns)
    .where(eq(auditRuns.agreementId, run.agreementId))
    .orderBy(sql`${auditRuns.requestedAt} desc`)
    .limit(1);
  const [cost] = await tx
    .select({ total: sql<number>`coalesce(sum(${auditRuns.totalCostUsd}), 0)::float8` })
    .from(auditRuns)
    .where(eq(auditRuns.agreementId, run.agreementId));
  const patch: Partial<typeof agreements.$inferInsert> = { totalCostUsd: cost?.total ?? 0 };
  if (latest?.id === run.id) Object.assign(patch, { latestRunId: run.id, latestRunStatus: run.status, latestVerdict: run.verdict });
  await tx.update(agreements).set(patch).where(eq(agreements.id, run.agreementId));
}

export async function projectAuditRuns(tx: Tx, e: StoredEvent): Promise<void> {
  if (e.streamType !== "AuditRun") return;
  const at = e.occurredAt;
  const id = e.streamId;
  const bump = { version: e.streamVersion, updatedAt: at };
  switch (e.type) {
    case "AuditRunRequested":
      await tx.insert(auditRuns).values({
        id,
        agreementId: e.payload.agreementId,
        status: "requested",
        model: e.payload.model,
        ruleSnapshot: e.payload.ruleSnapshot,
        requestedBy: e.metadata.actorUserId,
        requestedAt: at,
        version: e.streamVersion,
        updatedAt: at,
      });
      break;
    case "AuditRunStarted":
      await tx
        .update(auditRuns)
        .set({ status: "running", startedAt: at, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunClaudeCalled":
      await tx
        .update(auditRuns)
        .set({ modelCalls: sql`${auditRuns.modelCalls} + 1`, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunClaudeResponded":
      await tx
        .update(auditRuns)
        .set({
          totalCostUsd: sql`${auditRuns.totalCostUsd} + ${e.payload.costUsd}`,
          inputTokens: sql`${auditRuns.inputTokens} + ${e.payload.inputTokens}`,
          outputTokens: sql`${auditRuns.outputTokens} + ${e.payload.outputTokens}`,
          modelDurationMs: sql`${auditRuns.modelDurationMs} + ${e.payload.durationMs}`,
          ...bump,
        })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunClaudeOutputRejected":
      await tx
        .update(auditRuns)
        .set({ rejectedOutputs: sql`${auditRuns.rejectedOutputs} + 1`, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunCompleted":
      await tx
        .update(auditRuns)
        .set({
          status: "completed",
          verdict: e.payload.verdict,
          summary: e.payload.summary,
          findings: e.payload.findings,
          agreementMetadata: e.payload.agreementMetadata,
          failureReason: null,
          finishedAt: at,
          ...bump,
        })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunFailed":
      await tx
        .update(auditRuns)
        .set({ status: "failed", failureReason: e.payload.reason, finishedAt: at, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunCancelled":
      await tx
        .update(auditRuns)
        .set({ status: "cancelled", finishedAt: at, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    case "AuditRunRetried":
      await tx
        .update(auditRuns)
        .set({ status: "requested", verdict: null, failureReason: null, startedAt: null, finishedAt: null, ...bump })
        .where(eq(auditRuns.id, id));
      break;
    default:
      return;
  }
  await syncAgreementLatest(tx, id);
}
