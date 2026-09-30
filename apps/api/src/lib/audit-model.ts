import type { VerdictCountsDto } from "@app/contracts";
import { auditRuns, loadAuditModelSetting } from "@app/db";
import { type ResolvedAuditModel, resolveAuditModel } from "@app/llm";
import { sql } from "drizzle-orm";
import type { Ctx, Deps } from "./context.ts";

/** The model the next audit will use: the admin setting if any, else the environment default. */
export async function currentAuditModel(deps: Deps): Promise<{ resolved: ResolvedAuditModel; version: number }> {
  const { config, version } = await loadAuditModelSetting(deps.database.db);
  return { resolved: resolveAuditModel(deps.config.llmEnv, config), version };
}

/** Spend and model details are for admins only. */
export const seesCosts = (c: Ctx): boolean => c.get("user")?.role === "admin";

export async function verdictCounts(deps: Deps): Promise<VerdictCountsDto> {
  const [v] = await deps.database.db
    .select({
      pass: sql<number>`count(*) filter (where ${auditRuns.verdict} = 'pass')::int`,
      warn: sql<number>`count(*) filter (where ${auditRuns.verdict} = 'warn')::int`,
      fail: sql<number>`count(*) filter (where ${auditRuns.verdict} = 'fail')::int`,
      failedRuns: sql<number>`count(*) filter (where ${auditRuns.status} = 'failed')::int`,
      inProgress: sql<number>`count(*) filter (where ${auditRuns.status} in ('requested', 'running'))::int`,
    })
    .from(auditRuns);
  return v!;
}
