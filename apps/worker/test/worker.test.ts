import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auditLog, events, jobs, workerHeartbeats } from "@app/db";
import { createTestDatabase, type TestDatabase } from "@app/test-utils";
import { eq } from "drizzle-orm";
import { Worker } from "../src/worker.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("worker", () => {
  test("records WorkerStarted and WorkerStopped as System events with a heartbeat", async () => {
    const w = new Worker({ database: t, handlers: {}, workerId: "w-life", pollMs: 50 });
    await w.start();
    const [hb] = await t.db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, "w-life"));
    expect(hb).toBeTruthy();
    await w.stop("test");
    const rows = await t.db.select().from(events).where(eq(events.streamId, w.streamId));
    expect(rows.map((r) => r.eventType)).toEqual(["WorkerStarted", "WorkerStopped"]);
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.streamId, w.streamId));
    expect(logs.map((l) => l.actorType)).toEqual(["worker", "worker"]);
    expect(logs[0]!.summary).toContain("Worker w-life started");
  });

  test("runs handlers, retries failures, and fails after max attempts", async () => {
    const seen: number[] = [];
    const w = new Worker({
      database: t,
      workerId: "w-jobs",
      handlers: {
        ok: async (job) => {
          seen.push((job.payload as { n: number }).n);
        },
        boom: async () => {
          throw new Error("kaboom");
        },
      },
    });
    const [ok] = await t.db
      .insert(jobs)
      .values({ kind: "ok", payload: { n: 7 } })
      .returning();
    const [bad] = await t.db.insert(jobs).values({ kind: "boom", payload: {}, maxAttempts: 2 }).returning();

    expect(await w.drain()).toBe(2);
    expect(seen).toEqual([7]);
    expect((await t.db.select().from(jobs).where(eq(jobs.id, ok!.id)))[0]!.status).toBe("done");
    let [b] = await t.db.select().from(jobs).where(eq(jobs.id, bad!.id));
    expect(b).toMatchObject({ status: "pending", attempts: 1, lastError: "kaboom" });

    await t.db
      .update(jobs)
      .set({ runAfter: new Date(0) })
      .where(eq(jobs.id, bad!.id));
    await w.drain();
    [b] = await t.db.select().from(jobs).where(eq(jobs.id, bad!.id));
    expect(b).toMatchObject({ status: "failed", attempts: 2 });
  });

  test("wakes on NOTIFY without waiting for the poll interval", async () => {
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const w = new Worker({ database: t, workerId: "w-notify", pollMs: 60_000, handlers: { ping: async () => done() } });
    await w.start();
    await t.db.insert(jobs).values({ kind: "ping", payload: {} });
    await t.sql`select pg_notify('jobs', '')`;
    const winner = await Promise.race([finished.then(() => "handled"), Bun.sleep(3000).then(() => "timeout")]);
    await w.stop("test");
    expect(winner).toBe("handled");
  });
});

test("parallel lanes process jobs concurrently", async () => {
  let active = 0;
  let peak = 0;
  let done = 0;
  const w = new Worker({
    database: t,
    workerId: "w-parallel",
    pollMs: 50,
    concurrency: 3,
    handlers: {
      slow: async () => {
        active++;
        peak = Math.max(peak, active);
        await Bun.sleep(300);
        active--;
        done++;
      },
    },
  });
  await t.db.insert(jobs).values([1, 2, 3].map((n) => ({ kind: "slow", payload: { n } })));
  await w.start();
  const deadline = Date.now() + 5000;
  while (done < 3 && Date.now() < deadline) await Bun.sleep(50);
  await w.stop("test");
  expect(done).toBe(3);
  expect(peak).toBe(3);
});
