import { rehydrateDeep } from "@app/anonymization";
import { type AuditRunDetailDto, type CostsDto, type FindingDto, type PromptAttemptDto, RunActionBody } from "@app/contracts";
import { AuditRunAggregate, agreements, agreementTexts, auditLog, auditRunPrompts, auditRuns, executeCommand } from "@app/db";
import { AppError, auditRunLifecycleEventTypes } from "@app/domain";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { seesCosts } from "../lib/audit-model.ts";
import { requireRole, requireUser } from "../lib/auth.ts";
import { type Deps, type Env, metaFrom } from "../lib/context.ts";
import { redactTimeline, toAgreementDto, toAuditLogDto, toRunSummaryDto } from "../lib/dto.ts";
import { parseJson, parseTextView, parseUuidParam } from "../lib/validate.ts";
import { recordView } from "../lib/views.ts";

const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function auditRoutes(deps: Deps) {
  const { db } = deps.database;
  const loadRun = async (id: string) => {
    const [row] = await db
      .select({ run: auditRuns, agreement: agreements })
      .from(auditRuns)
      .innerJoin(agreements, eq(agreements.id, auditRuns.agreementId))
      .where(eq(auditRuns.id, id));
    if (!row) throw new AppError("NOT_FOUND", "Audit run not found.");
    return row;
  };

  return new Hono<Env>()
    .use(requireUser)
    .get("/", async (c) => {
      const agreementId = c.req.query("agreementId");
      const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 200));
      const showCosts = seesCosts(c);
      const rows = await db
        .select({ run: auditRuns, title: agreements.title })
        .from(auditRuns)
        .innerJoin(agreements, eq(agreements.id, auditRuns.agreementId))
        .where(agreementId ? eq(auditRuns.agreementId, agreementId) : undefined)
        .orderBy(desc(auditRuns.requestedAt))
        .limit(limit);
      return c.json(rows.map((r) => toRunSummaryDto(r.run, r.title, showCosts)));
    })
    .get("/costs", requireRole("admin"), async (c) => {
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [[total], [month], byModel, byDay] = await Promise.all([
        db
          .select({
            costUsd: sql<number>`coalesce(sum(${auditRuns.totalCostUsd}), 0)::float8`,
            runs: sql<number>`count(*)::int`,
            inputTokens: sql<number>`coalesce(sum(${auditRuns.inputTokens}), 0)::int`,
            outputTokens: sql<number>`coalesce(sum(${auditRuns.outputTokens}), 0)::int`,
          })
          .from(auditRuns),
        db
          .select({ costUsd: sql<number>`coalesce(sum(${auditRuns.totalCostUsd}), 0)::float8`, runs: sql<number>`count(*)::int` })
          .from(auditRuns)
          .where(gte(auditRuns.requestedAt, monthStart)),
        db
          .select({
            model: auditRuns.model,
            costUsd: sql<number>`sum(${auditRuns.totalCostUsd})::float8`,
            runs: sql<number>`count(*)::int`,
          })
          .from(auditRuns)
          .groupBy(auditRuns.model)
          .orderBy(desc(sql`sum(${auditRuns.totalCostUsd})`)),
        db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${auditRuns.requestedAt}), 'YYYY-MM-DD')`,
            costUsd: sql<number>`sum(${auditRuns.totalCostUsd})::float8`,
            runs: sql<number>`count(*)::int`,
          })
          .from(auditRuns)
          .where(gte(auditRuns.requestedAt, since))
          .groupBy(sql`1`)
          .orderBy(asc(sql`1`)),
      ]);
      const body: CostsDto = {
        currency: "USD",
        total: total!,
        thisMonth: month!,
        byModel: byModel.map((m) => ({ ...m, avgCostUsd: m.runs ? m.costUsd / m.runs : 0 })),
        byDay,
      };
      return c.json(body);
    })
    .get("/:id", async (c) => {
      const id = parseUuidParam(c, "id");
      await loadRun(id);
      await recordView(deps, c, AuditRunAggregate, id, { type: "ViewReport" }, "AuditReportViewed");
      const { run, agreement } = await loadRun(id);
      const showCosts = seesCosts(c);
      const timeline = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.streamId, id),
            eq(auditLog.isRead, false),
            showCosts ? undefined : inArray(auditLog.eventType, [...auditRunLifecycleEventTypes]),
          ),
        )
        .orderBy(asc(auditLog.globalPosition));
      const view = parseTextView(c.req.query("view"));
      const [text] = await db
        .select({ anonymization: agreementTexts.anonymization })
        .from(agreementTexts)
        .where(eq(agreementTexts.agreementId, agreement.id));
      // The model answered in placeholders; people read the report with the real values put back.
      const entities = view === "original" ? (text?.anonymization?.entities ?? []) : [];
      const findings = rehydrateDeep((run.findings as FindingDto[] | null) ?? [], entities)
        .slice()
        .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
      const body: AuditRunDetailDto = {
        ...toRunSummaryDto(run, agreement.title, showCosts),
        view,
        anonymized: !!text?.anonymization,
        summary: run.summary === null ? null : rehydrateDeep(run.summary, entities),
        findings,
        agreementMetadata: rehydrateDeep(run.agreementMetadata as AuditRunDetailDto["agreementMetadata"], entities),
        agreement: toAgreementDto(agreement, showCosts),
        timeline: redactTimeline(timeline.map(toAuditLogDto), showCosts),
      };
      return c.json(body);
    })
    .get("/:id/prompts", requireRole("admin"), async (c) => {
      const id = parseUuidParam(c, "id");
      await loadRun(id);
      const rows = await db.select().from(auditRunPrompts).where(eq(auditRunPrompts.runId, id)).orderBy(asc(auditRunPrompts.attemptNo));
      const body: PromptAttemptDto[] = rows.map((r) => ({
        attemptNo: r.attemptNo,
        model: r.model,
        systemPrompt: r.systemPrompt,
        prompt: r.prompt,
        rawResponse: r.rawResponse,
        createdAt: r.createdAt.toISOString(),
      }));
      return c.json(body);
    })
    .post("/:id/cancel", requireRole("auditor"), async (c) => {
      const id = parseUuidParam(c, "id");
      const { version } = await parseJson(c, RunActionBody);
      await executeCommand(db, AuditRunAggregate, id, { type: "CancelAudit" }, metaFrom(c), { expectedVersion: version });
      const { run, agreement } = await loadRun(id);
      return c.json(toRunSummaryDto(run, agreement.title, seesCosts(c)));
    })
    .post("/:id/retry", requireRole("auditor"), async (c) => {
      const id = parseUuidParam(c, "id");
      const { version } = await parseJson(c, RunActionBody);
      await executeCommand(db, AuditRunAggregate, id, { type: "RetryAudit" }, metaFrom(c), { expectedVersion: version });
      const { run, agreement } = await loadRun(id);
      return c.json(toRunSummaryDto(run, agreement.title, seesCosts(c)));
    });
}
