import { type Database, executeCommand, RuleAggregate, rules } from "@app/db";
import { eq } from "drizzle-orm";
import { seedRuleId, seedRules } from "./rules.ts";
import { seedMeta } from "./users.ts";

/** Idempotent: rules whose slug already exists are skipped. */
export async function seedAllRules(database: Database): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const r of seedRules) {
    const [existing] = await database.db.select({ id: rules.id }).from(rules).where(eq(rules.slug, r.slug));
    if (existing) {
      skipped++;
      continue;
    }
    await executeCommand(database.db, RuleAggregate, seedRuleId(r.slug), { type: "CreateRule", languages: [], ...r }, seedMeta());
    created++;
  }
  return { created, skipped };
}
