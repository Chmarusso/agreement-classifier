import { afterAll, beforeAll, expect, test } from "bun:test";
import { auditLog, events, users } from "@app/db";
import { createTestDatabase, type TestDatabase } from "@app/test-utils";
import { asc, eq } from "drizzle-orm";
import { seedAllUsers } from "../users.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

test("seed creates admin, auditor and viewer through events, and is idempotent", async () => {
  const first = await seedAllUsers(t);
  expect(first.created).toEqual(["admin@example.com", "auditor@example.com", "viewer@example.com"]);
  const second = await seedAllUsers(t);
  expect(second.created).toEqual([]);
  expect(second.skipped).toHaveLength(3);

  const rows = await t.db.select().from(users).orderBy(asc(users.email));
  expect(rows.map((u) => [u.email, u.role])).toEqual([
    ["admin@example.com", "admin"],
    ["auditor@example.com", "auditor"],
    ["viewer@example.com", "viewer"],
  ]);
  expect(await t.db.select().from(events).where(eq(events.eventType, "UserRegistered"))).toHaveLength(3);
  expect(await t.db.select().from(auditLog)).toHaveLength(3);
});
