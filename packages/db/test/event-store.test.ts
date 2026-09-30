import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ConcurrencyError, type NewEvent } from "@app/domain";
import { createTestDatabase, systemMeta, type TestDatabase } from "@app/test-utils";
import { asc, eq, sql } from "drizzle-orm";
import {
  AuthAggregate,
  appendToStream,
  auditLog,
  claimJob,
  events,
  executeCommand,
  failJob,
  jobs,
  readStream,
  reapExpiredJobs,
  rebuildProjections,
  sessions,
  UserAggregate,
  users,
} from "../src/index.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

const register = (email: string): NewEvent => ({
  type: "UserRegistered",
  payload: { email, displayName: email, role: "viewer", invitedBy: null },
});

describe("event store", () => {
  test("appends with sequential stream versions and reads them back in order", async () => {
    const id = crypto.randomUUID();
    await t.db.transaction((tx) =>
      appendToStream(tx, {
        streamType: "User",
        streamId: id,
        expectedVersion: 0,
        events: [register("order@example.com"), { type: "UserRoleChanged", payload: { oldRole: "viewer", newRole: "auditor" } }],
        metadata: systemMeta(),
      }),
    );
    const stream = await readStream(t.db, "User", id);
    expect(stream.map((e) => [e.streamVersion, e.type])).toEqual([
      [1, "UserRegistered"],
      [2, "UserRoleChanged"],
    ]);
  });

  test("stale expectedVersion raises ConcurrencyError and writes nothing", async () => {
    const id = crypto.randomUUID();
    await t.db.transaction((tx) =>
      appendToStream(tx, {
        streamType: "User",
        streamId: id,
        expectedVersion: 0,
        events: [register("race@example.com")],
        metadata: systemMeta(),
      }),
    );
    const attempt = t.db.transaction((tx) =>
      appendToStream(tx, {
        streamType: "User",
        streamId: id,
        expectedVersion: 0,
        events: [{ type: "UserDeactivated", payload: { reason: null } }],
        metadata: systemMeta(),
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(ConcurrencyError);
    await attempt.catch(() => {});
    expect(await readStream(t.db, "User", id)).toHaveLength(1);
  });

  test("repeating an append with the same event id is a no-op", async () => {
    const id = crypto.randomUUID();
    const eventIds = [crypto.randomUUID()];
    const input = {
      streamType: "User" as const,
      streamId: id,
      expectedVersion: 0,
      events: [register("idem@example.com")],
      metadata: systemMeta(),
      eventIds,
    };
    const first = await t.db.transaction((tx) => appendToStream(tx, input));
    const second = await t.db.transaction((tx) => appendToStream(tx, input));
    expect(second.map((e) => e.eventId)).toEqual(first.map((e) => e.eventId));
    expect(await readStream(t.db, "User", id)).toHaveLength(1);
  });

  test("rejects a payload that fails its schema", async () => {
    const attempt = t.db.transaction((tx) =>
      appendToStream(tx, {
        streamType: "User",
        streamId: crypto.randomUUID(),
        expectedVersion: 0,
        events: [{ type: "UserRegistered", payload: { email: "not-an-email", displayName: "x", role: "viewer", invitedBy: null } }],
        metadata: systemMeta(),
      }),
    );
    await expect(attempt).rejects.toThrow();
    await attempt.catch(() => {});
  });

  test("rejects an event appended to the wrong stream type", async () => {
    const attempt = t.db.transaction((tx) =>
      appendToStream(tx, {
        streamType: "System",
        streamId: crypto.randomUUID(),
        expectedVersion: 0,
        events: [register("wrong@example.com")],
        metadata: systemMeta(),
      }),
    );
    await expect(attempt).rejects.toThrow(/does not belong/);
    await attempt.catch(() => {});
  });

  test("projections and audit log are written in the same transaction", async () => {
    const id = crypto.randomUUID();
    const meta = systemMeta();
    const [stored] = await t.db.transaction((tx) =>
      appendToStream(tx, { streamType: "User", streamId: id, expectedVersion: 0, events: [register("proj@example.com")], metadata: meta }),
    );
    const [u] = await t.db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({ email: "proj@example.com", role: "viewer", status: "active", version: 1 });
    const [log] = await t.db.select().from(auditLog).where(eq(auditLog.eventId, stored!.eventId));
    expect(log).toMatchObject({
      eventType: "UserRegistered",
      entityLabel: "proj@example.com",
      summary: "proj@example.com registered as viewer",
      actorType: "system",
    });
    expect((log!.metadata as { correlationId: string }).correlationId).toBe(meta.correlationId);
  });

  test("a failed projection rolls back the event", async () => {
    await executeCommand(
      t.db,
      UserAggregate,
      crypto.randomUUID(),
      { type: "RegisterUser", email: "dup@example.com", displayName: "d", role: "viewer", invitedBy: null },
      systemMeta(),
    );
    const before = (await t.db.select({ n: sql<number>`count(*)::int` }).from(events))[0]!.n;
    const attempt = executeCommand(
      t.db,
      UserAggregate,
      crypto.randomUUID(),
      { type: "RegisterUser", email: "dup@example.com", displayName: "d", role: "viewer", invitedBy: null },
      systemMeta(),
    );
    await expect(attempt).rejects.toThrow();
    await attempt.catch(() => {});
    const after = (await t.db.select({ n: sql<number>`count(*)::int` }).from(events))[0]!.n;
    expect(after).toBe(before);
  });

  test("every event has exactly one audit log row", async () => {
    const [{ e, a }] = (await t.db.execute(
      sql`select (select count(*) from events)::int as e, (select count(*) from audit_log)::int as a`,
    )) as unknown as [{ e: number; a: number }];
    expect(a).toBe(e);
  });
});

describe("executeCommand", () => {
  test("expectedVersion mismatch is rejected before deciding", async () => {
    const id = crypto.randomUUID();
    await executeCommand(
      t.db,
      UserAggregate,
      id,
      { type: "RegisterUser", email: "ver@example.com", displayName: "v", role: "viewer", invitedBy: null },
      systemMeta(),
    );
    const attempt = executeCommand(t.db, UserAggregate, id, { type: "ChangeUserRole", role: "admin" }, systemMeta(), {
      expectedVersion: 5,
    });
    await expect(attempt).rejects.toBeInstanceOf(ConcurrencyError);
    await attempt.catch(() => {});
  });

  test("concurrent commands on one stream: exactly one wins", async () => {
    const id = crypto.randomUUID();
    await executeCommand(
      t.db,
      UserAggregate,
      id,
      { type: "RegisterUser", email: "conc@example.com", displayName: "c", role: "viewer", invitedBy: null },
      systemMeta(),
    );
    const results = await Promise.allSettled(
      (["auditor", "admin", "auditor", "admin"] as const).map((role) =>
        executeCommand(t.db, UserAggregate, id, { type: "ChangeUserRole", role }, systemMeta(), { expectedVersion: 1 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
    }
  });
});

describe("rebuild", () => {
  test("replaying all events reproduces identical projection tables", async () => {
    const id = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await executeCommand(
      t.db,
      UserAggregate,
      id,
      { type: "RegisterUser", email: "rebuild@example.com", displayName: "r", role: "viewer", invitedBy: null },
      systemMeta(),
    );
    await executeCommand(
      t.db,
      AuthAggregate,
      id,
      {
        type: "VerifyOtp",
        userActive: true,
        now: new Date(),
        submittedHash: "0".repeat(64),
        isDevCode: true,
        sessionId,
        tokenHash: "f".repeat(64),
        sessionExpiresAt: new Date(Date.now() + 60_000),
      },
      systemMeta(),
    );
    await executeCommand(t.db, AuthAggregate, id, { type: "Logout", sessionId }, systemMeta());

    const snapshot = async () => ({
      users: await t.db.select().from(users).orderBy(asc(users.id)),
      sessions: await t.db.select().from(sessions).orderBy(asc(sessions.id)),
      auditLog: await t.db.select().from(auditLog).orderBy(asc(auditLog.globalPosition)),
    });
    const before = await snapshot();
    const replayed = await rebuildProjections(t.db);
    const after = await snapshot();
    expect(replayed).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });
});

describe("job queue", () => {
  test("two workers never claim the same job, expired leases are requeued, max attempts fails", async () => {
    await t.db.insert(jobs).values([
      { kind: "test", payload: { n: 1 } },
      { kind: "test", payload: { n: 2 } },
    ]);
    const [a, b] = await Promise.all([claimJob(t.db, "w1", 60_000), claimJob(t.db, "w2", 60_000)]);
    expect(a && b).toBeTruthy();
    expect(a!.id).not.toBe(b!.id);
    expect(await claimJob(t.db, "w3", 60_000)).toBeNull();

    await t.db
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, a!.id));
    const reaped = await reapExpiredJobs(t.db);
    expect(reaped.map((j) => j.id)).toEqual([a!.id]);
    const [requeued] = await t.db.select().from(jobs).where(eq(jobs.id, a!.id));
    expect(requeued).toMatchObject({ status: "pending", lastError: "lease expired", attempts: 1 });

    await t.db.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, b!.id));
    const [bRow] = await t.db.select().from(jobs).where(eq(jobs.id, b!.id));
    expect(await failJob(t.db, bRow!, "boom")).toBe("failed");
  });
});

describe("read events and concurrency", () => {
  test("viewing a rule does not invalidate an editor's version", async () => {
    const { RuleAggregate } = await import("../src/index.ts");
    const id = crypto.randomUUID();
    const content = {
      title: "Read test",
      description: "A rule used for testing reads.",
      severity: "low" as const,
      category: "Test",
      appliesTo: [],
    };
    await executeCommand(t.db, RuleAggregate, id, { type: "CreateRule", slug: `read-test-${id.slice(0, 8)}`, ...content }, systemMeta());
    await executeCommand(t.db, RuleAggregate, id, { type: "ViewRule" }, systemMeta());
    await executeCommand(t.db, RuleAggregate, id, { type: "ViewRule" }, systemMeta());
    const edited = await executeCommand(t.db, RuleAggregate, id, { type: "UpdateRule", ...content, severity: "high" }, systemMeta(), {
      expectedVersion: 1,
    });
    expect(edited.events.map((e) => e.type)).toEqual(["RuleUpdated"]);
    expect(edited.events[0]!.streamVersion).toBe(4);
  });
});
