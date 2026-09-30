import { AnonymizationConfig, AuditModelConfig, type StoredEvent } from "@app/domain";
import type { Tx } from "../client.ts";
import { appSettings } from "../schema.ts";

export const AUDIT_MODEL_KEY = "audit_model";
export const ANONYMIZATION_KEY = "anonymization";

export async function projectSettings(tx: Tx, e: StoredEvent): Promise<void> {
  let key: string;
  let value: unknown;
  if (e.type === "AuditModelConfigured" || e.type === "AuditModelReset") {
    key = AUDIT_MODEL_KEY;
    value = e.type === "AuditModelConfigured" ? AuditModelConfig.parse(e.payload) : null;
  } else if (e.type === "AnonymizationConfigured" || e.type === "AnonymizationReset") {
    key = ANONYMIZATION_KEY;
    value = e.type === "AnonymizationConfigured" ? AnonymizationConfig.parse(e.payload) : null;
  } else return;
  await tx
    .insert(appSettings)
    .values({ key, value, version: e.streamVersion, updatedAt: e.occurredAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, version: e.streamVersion, updatedAt: e.occurredAt } });
}
