import { AnonymizationConfig, AuditModelConfig } from "@app/domain";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "./client.ts";
import { ANONYMIZATION_KEY, AUDIT_MODEL_KEY } from "./projections/settings.ts";
import { appSettings } from "./schema.ts";

/** The admin-chosen audit model, with the stream version for optimistic edits. Null config means environment default. */
export async function loadAuditModelSetting(db: Db | Tx): Promise<{ config: AuditModelConfig | null; version: number }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, AUDIT_MODEL_KEY));
  if (!row) return { config: null, version: 0 };
  const parsed = AuditModelConfig.nullable().safeParse(row.value);
  return { config: parsed.success ? parsed.data : null, version: row.version };
}

/** The admin's anonymization settings with the stream version; null config means the defaults apply. */
export async function loadAnonymizationSetting(db: Db | Tx): Promise<{ config: AnonymizationConfig | null; version: number }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, ANONYMIZATION_KEY));
  if (!row) return { config: null, version: 0 };
  const parsed = AnonymizationConfig.nullable().safeParse(row.value);
  return { config: parsed.success ? parsed.data : null, version: row.version };
}
