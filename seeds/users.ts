import { type Database, executeCommand, UserAggregate, users } from "@app/db";
import type { EventMetadata, Role } from "@app/domain";
import { eq } from "drizzle-orm";

export const seedUsers: { email: string; displayName: string; role: Role }[] = [
  { email: "admin@example.com", displayName: "Ada Admin", role: "admin" },
  { email: "auditor@example.com", displayName: "Aurelia Auditor", role: "auditor" },
  { email: "viewer@example.com", displayName: "Victor Viewer", role: "viewer" },
];

export const seedMeta = (): EventMetadata => ({
  actorUserId: null,
  actorType: "system",
  correlationId: `seed-${crypto.randomUUID()}`,
  causationId: null,
  requestId: null,
  ip: null,
  userAgent: "seed",
});

/** Idempotent: existing emails are skipped. Goes through command handlers so events exist. */
export async function seedAllUsers(database: Database): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const u of seedUsers) {
    const [existing] = await database.db.select({ id: users.id }).from(users).where(eq(users.email, u.email));
    if (existing) {
      skipped.push(u.email);
      continue;
    }
    await executeCommand(database.db, UserAggregate, crypto.randomUUID(), { type: "RegisterUser", ...u, invitedBy: null }, seedMeta());
    created.push(u.email);
  }
  return { created, skipped };
}
