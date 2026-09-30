import type { StoredEvent } from "@app/domain";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "./client.ts";
import { jobs } from "./schema.ts";

export const JOBS_CHANNEL = "jobs";
export type Job = typeof jobs.$inferSelect;

/** Maps an event to the background jobs it causes. Extended in later milestones. */
export function jobsForEvent(event: StoredEvent): { kind: string; payload: unknown }[] {
  switch (event.type) {
    case "AgreementUploaded":
      return [{ kind: "extract_text", payload: { agreementId: event.streamId } }];
    case "AuditRunRequested":
    case "AuditRunRetried":
      return [{ kind: "run_audit", payload: { runId: event.streamId } }];
    default:
      return [];
  }
}

export async function enqueueJobsFor(tx: Tx, event: StoredEvent): Promise<void> {
  const toEnqueue = jobsForEvent(event);
  if (toEnqueue.length === 0) return;
  await tx.insert(jobs).values(toEnqueue.map((j) => ({ ...j, sourceEventId: event.eventId })));
  await tx.execute(sql`select pg_notify(${JOBS_CHANNEL}, '')`);
}

/** Claims one due job with SKIP LOCKED so concurrent workers never share a job. */
export async function claimJob(db: DbOrTx, workerId: string, leaseMs: number): Promise<Job | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    update jobs set status = 'running', locked_by = ${workerId},
      locked_until = now() + (${leaseMs} || ' milliseconds')::interval,
      attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs where status = 'pending' and run_after <= now()
      order by run_after for update skip locked limit 1
    )
    returning id`);
  const id = rows[0]?.id as string | undefined;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export async function completeJob(db: DbOrTx, id: string): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedUntil: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

export async function failJob(db: DbOrTx, job: Job, error: string, retryDelayMs = 5_000): Promise<"retry" | "failed"> {
  const final = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: final ? "failed" : "pending",
      lastError: error,
      lockedBy: null,
      lockedUntil: null,
      runAfter: new Date(Date.now() + retryDelayMs),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
  return final ? "failed" : "retry";
}

/** Returns running jobs whose lease expired to pending (or failed after max attempts). */
export async function reapExpiredJobs(db: DbOrTx): Promise<Job[]> {
  const expired = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, new Date())));
  for (const job of expired) await failJob(db, job, "lease expired", 0);
  return expired;
}
