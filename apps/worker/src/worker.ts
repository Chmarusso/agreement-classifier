import { hostname } from "node:os";
import {
  appendToStream,
  claimJob,
  completeJob,
  type Database,
  failJob,
  JOBS_CHANNEL,
  type Job,
  reapExpiredJobs,
  workerHeartbeats,
} from "@app/db";
import type { EventMetadata, NewEvent } from "@app/domain";

export type JobHandler = (job: Job, ctx: { database: Database; workerId: string }) => Promise<void>;

export interface WorkerOptions {
  database: Database;
  handlers: Record<string, JobHandler>;
  workerId?: string;
  version?: string;
  pollMs?: number;
  leaseMs?: number;
  reapEveryMs?: number;
  heartbeatEveryMs?: number;
  /** Jobs processed in parallel. Model calls are slow, so this defaults to 3. */
  concurrency?: number;
}

const workerMeta = (): EventMetadata => ({
  actorUserId: null,
  actorType: "worker",
  correlationId: crypto.randomUUID(),
  causationId: null,
  requestId: null,
  ip: null,
  userAgent: null,
});

/**
 * Claims jobs from the Postgres queue, wakes on NOTIFY with polling as the
 * fallback, reaps expired leases, and records its lifecycle as System events.
 */
export class Worker {
  readonly workerId: string;
  /** Stream id of this worker's lifecycle events. */
  readonly streamId = crypto.randomUUID();
  private running = false;
  private wakers = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private unlisten: (() => Promise<void>) | null = null;
  private loopDone: Promise<void> = Promise.resolve();
  private version = 0;

  constructor(private readonly opts: WorkerOptions) {
    this.workerId = opts.workerId ?? `worker-${hostname()}-${process.pid}`;
  }

  private async emit(event: NewEvent): Promise<void> {
    await this.opts.database.db.transaction(async (tx) => {
      const stored = await appendToStream(tx, {
        streamType: "System",
        streamId: this.streamId,
        expectedVersion: this.version,
        events: [event],
        metadata: workerMeta(),
      });
      this.version += stored.length;
    });
  }

  private async heartbeat(startedAt: Date): Promise<void> {
    const now = new Date();
    await this.opts.database.db
      .insert(workerHeartbeats)
      .values({ workerId: this.workerId, hostname: hostname(), startedAt, lastSeenAt: now })
      .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: now } });
  }

  async start(): Promise<void> {
    const startedAt = new Date();
    this.running = true;
    await this.emit({
      type: "WorkerStarted",
      payload: { workerId: this.workerId, version: this.opts.version ?? "dev", hostname: hostname() },
    });
    await this.heartbeat(startedAt);
    const sub = await this.opts.database.sql.listen(JOBS_CHANNEL, () => this.wakeAll());
    this.unlisten = () => sub.unlisten();
    this.timers.push(
      setInterval(() => void this.heartbeat(startedAt).catch(logError("heartbeat")), this.opts.heartbeatEveryMs ?? 10_000),
      setInterval(() => void this.reap().catch(logError("reaper")), this.opts.reapEveryMs ?? 60_000),
    );
    this.loopDone = Promise.all(Array.from({ length: this.opts.concurrency ?? 3 }, () => this.loop())).then(() => {});
  }

  async stop(reason = "shutdown"): Promise<void> {
    this.running = false;
    this.wakeAll();
    for (const t of this.timers) clearInterval(t);
    await this.loopDone;
    await this.unlisten?.();
    await this.emit({ type: "WorkerStopped", payload: { workerId: this.workerId, reason } });
  }

  private wakeAll(): void {
    for (const w of [...this.wakers]) w();
  }

  async reap(): Promise<number> {
    const expired = await reapExpiredJobs(this.opts.database.db);
    if (expired.length) console.warn(`[worker] requeued ${expired.length} job(s) with expired lease`);
    return expired.length;
  }

  /** Processes due jobs until none are left. Exposed for tests. */
  async drain(): Promise<number> {
    let processed = 0;
    for (;;) {
      const job = await claimJob(this.opts.database.db, this.workerId, this.opts.leaseMs ?? 10 * 60_000);
      if (!job) return processed;
      await this.run(job);
      processed++;
    }
  }

  private async run(job: Job): Promise<void> {
    const handler = this.opts.handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      await handler(job, { database: this.opts.database, workerId: this.workerId });
      await completeJob(this.opts.database.db, job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await failJob(this.opts.database.db, job, message);
      console.error(`[worker] job ${job.id} (${job.kind}) failed, ${outcome}: ${message}`);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drain();
      } catch (err) {
        logError("loop")(err);
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(t);
          this.wakers.delete(wake);
          resolve();
        };
        const t = setTimeout(wake, this.opts.pollMs ?? 2_000);
        this.wakers.add(wake);
      });
    }
  }
}

const logError = (where: string) => (err: unknown) => console.error(`[worker] ${where} failed`, err);
