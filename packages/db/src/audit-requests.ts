import {
  type AgreementLanguage,
  type AgreementType,
  AppError,
  type AuditModelConfig,
  type EventMetadata,
  rulesApplyingTo,
} from "@app/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.ts";
import { AuditRunAggregate, executeCommand } from "./commands.ts";
import { rules } from "./schema.ts";

export interface AuditRequest {
  agreementId: string;
  agreementType: AgreementType;
  /** Detected at extraction; null for agreements extracted before language detection. */
  agreementLanguage?: AgreementLanguage | null;
  /** Explicit rules; defaults to every active rule that applies to the agreement type. */
  ruleIds?: string[];
  model: { label: string; config: AuditModelConfig };
  meta: EventMetadata;
}

/** Snapshots the rules and records an AuditRunRequested event, which enqueues the worker job. */
export async function requestAudit(db: Db, req: AuditRequest): Promise<{ runId: string; ruleCount: number }> {
  const active = eq(rules.status, "active");
  // An empty list means "the defaults"; duplicates count once.
  const ruleIds = req.ruleIds?.length ? [...new Set(req.ruleIds)] : null;
  const selected = ruleIds
    ? await db
        .select()
        .from(rules)
        .where(and(inArray(rules.id, ruleIds), active))
    : rulesApplyingTo(await db.select().from(rules).where(active), req.agreementType, req.agreementLanguage ?? null);
  if (ruleIds && selected.length !== ruleIds.length) {
    throw new AppError("VALIDATION_FAILED", "Some rules do not exist or are archived.", [
      { path: "ruleIds", message: "Unknown or archived rule" },
    ]);
  }
  if (selected.length === 0) {
    const lang = req.agreementLanguage ? ` in ${req.agreementLanguage === "pl" ? "Polish" : "English"}` : "";
    throw new AppError("CONFLICT", `No active rules apply to ${req.agreementType} agreements${lang}. Add a rule first.`);
  }
  const runId = crypto.randomUUID();
  await executeCommand(
    db,
    AuditRunAggregate,
    runId,
    {
      type: "RequestAudit",
      agreementId: req.agreementId,
      ruleSnapshot: selected.map((r) => ({ ruleId: r.id, version: r.contentVersion })),
      model: req.model.label,
      modelConfig: req.model.config,
    },
    req.meta,
  );
  return { runId, ruleCount: selected.length };
}
