import type { AuditLogEntryDto } from "@app/contracts";
import { auditLog, type Database, EVENTS_CHANNEL } from "@app/db";
import { asc, gt, max } from "drizzle-orm";
import { toAuditLogDto } from "./dto.ts";

type Listener = (entry: AuditLogEntryDto) => void;

/**
 * Tails the audit_log projection on Postgres NOTIFY and fans entries out to
 * SSE subscribers. One LISTEN connection per API process.
 */
export class AuditBroadcaster {
  private listeners = new Set<Listener>();
  private lastPosition = 0;
  private unlisten: (() => Promise<void>) | null = null;
  private draining: Promise<void> = Promise.resolve();

  constructor(private readonly database: Database) {}

  async start(): Promise<void> {
    const [row] = await this.database.db.select({ m: max(auditLog.globalPosition) }).from(auditLog);
    this.lastPosition = row?.m ?? 0;
    const sub = await this.database.sql.listen(EVENTS_CHANNEL, () => {
      this.draining = this.draining.then(() => this.drain()).catch((e) => console.error("[sse] drain failed", e));
    });
    this.unlisten = () => sub.unlisten();
  }

  async stop(): Promise<void> {
    await this.unlisten?.();
    this.listeners.clear();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  private async drain(): Promise<void> {
    const rows = await this.database.db
      .select()
      .from(auditLog)
      .where(gt(auditLog.globalPosition, this.lastPosition))
      .orderBy(asc(auditLog.globalPosition))
      .limit(500);
    for (const r of rows) {
      this.lastPosition = r.globalPosition;
      const dto = toAuditLogDto(r);
      for (const fn of this.listeners) fn(dto);
    }
  }
}
