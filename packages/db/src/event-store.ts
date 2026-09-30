import { ConcurrencyError, EventMetadata, type NewEvent, parseEvent, type StoredEvent, type StreamType, streamTypeOf } from "@app/domain";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "./client.ts";
import { enqueueJobsFor } from "./jobs.ts";
import { applyInlineProjections } from "./projections/index.ts";
import { events } from "./schema.ts";

export const EVENTS_CHANNEL = "events";

export interface AppendInput {
  streamType: StreamType;
  streamId: string;
  /** Version the caller loaded. 0 for a new stream. */
  expectedVersion: number;
  events: NewEvent[];
  metadata: EventMetadata;
  /** Optional caller-supplied ids; a repeated id makes the append a no-op. */
  eventIds?: string[];
}

type Row = typeof events.$inferSelect;

export function toStoredEvent(row: Row): StoredEvent {
  const parsed = parseEvent(row.eventType, row.payload);
  return {
    ...parsed,
    globalPosition: row.globalPosition,
    eventId: row.eventId,
    streamType: row.streamType as StreamType,
    streamId: row.streamId,
    streamVersion: row.streamVersion,
    eventVersion: row.eventVersion,
    metadata: EventMetadata.parse(row.metadata),
    occurredAt: row.occurredAt,
  } as StoredEvent;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const anyE = e as { code?: string; constraint_name?: string; cause?: unknown };
    if (anyE.code === "23505" && anyE.constraint_name === constraint) return true;
    e = anyE.cause;
  }
  return false;
}

/**
 * Appends events to one stream inside the caller's transaction, then updates
 * inline projections, enqueues jobs, and notifies listeners. All of it commits
 * or rolls back together.
 */
export async function appendToStream(tx: Tx, input: AppendInput): Promise<StoredEvent[]> {
  if (input.events.length === 0) return [];
  const metadata = EventMetadata.parse(input.metadata);

  if (input.eventIds?.length) {
    const existing = await tx.select().from(events).where(inArray(events.eventId, input.eventIds));
    if (existing.length > 0) return existing.map(toStoredEvent);
  }

  const values = input.events.map((e, i) => {
    if (streamTypeOf(e.type) !== input.streamType) {
      throw new Error(`${e.type} does not belong to stream type ${input.streamType}`);
    }
    const valid = parseEvent(e.type, e.payload);
    return {
      eventId: input.eventIds?.[i] ?? crypto.randomUUID(),
      streamType: input.streamType,
      streamId: input.streamId,
      streamVersion: input.expectedVersion + i + 1,
      eventType: valid.type,
      payload: valid.payload,
      metadata,
    };
  });

  let rows: Row[];
  try {
    // A savepoint keeps the outer transaction usable when the insert conflicts.
    rows = await tx.transaction((sp) => sp.insert(events).values(values).returning());
  } catch (err) {
    if (isUniqueViolation(err, "events_stream_version_uq")) {
      throw new ConcurrencyError(input.streamType, input.streamId, input.expectedVersion);
    }
    throw err;
  }

  const stored = rows.map(toStoredEvent);
  for (const event of stored) {
    await applyInlineProjections(tx, event);
    await enqueueJobsFor(tx, event);
  }
  const last = stored[stored.length - 1]!;
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${String(last.globalPosition)})`);
  return stored;
}

export async function readStream(db: DbOrTx, streamType: StreamType, streamId: string): Promise<StoredEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.streamType, streamType), eq(events.streamId, streamId)))
    .orderBy(asc(events.streamVersion));
  return rows.map(toStoredEvent);
}

export async function readAll(db: DbOrTx, afterPosition: number, limit: number): Promise<StoredEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(gt(events.globalPosition, afterPosition))
    .orderBy(asc(events.globalPosition))
    .limit(limit);
  return rows.map(toStoredEvent);
}
