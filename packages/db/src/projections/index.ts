import type { StoredEvent } from "@app/domain";
import type { Tx } from "../client.ts";
import { projectAuditLog } from "./audit-log.ts";
import { projectAgreements, projectAuditRuns, projectRules } from "./catalog.ts";
import { projectSettings } from "./settings.ts";
import { projectUsers } from "./users.ts";

/** Projections applied in the append transaction. Order matters: audit_log reads users. */
const inline = [projectUsers, projectRules, projectAgreements, projectAuditRuns, projectSettings, projectAuditLog];

export async function applyInlineProjections(tx: Tx, event: StoredEvent): Promise<void> {
  for (const project of inline) await project(tx, event);
}
