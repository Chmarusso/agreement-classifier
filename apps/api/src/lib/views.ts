import { type Aggregate, auditLog, executeCommand } from "@app/db";
import { ConcurrencyError } from "@app/domain";
import { and, eq, gte } from "drizzle-orm";
import { type Ctx, type Deps, metaFrom } from "./context.ts";

const VIEW_WINDOW_MS = 5 * 60 * 1000;

/**
 * Records that the current user looked at an entity. Polling and reloads within
 * five minutes count as one view. A view never fails the read: it retries on a
 * race with a concurrent write and is dropped (and logged) if it still cannot be stored.
 */
export async function recordView<S, C>(deps: Deps, c: Ctx, agg: Aggregate<S, C>, id: string, command: C, eventType: string): Promise<void> {
  const user = c.get("user");
  const { db } = deps.database;
  const since = new Date(Date.now() - VIEW_WINDOW_MS);
  const [recent] = await db
    .select({ p: auditLog.globalPosition })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.streamId, id),
        eq(auditLog.eventType, eventType),
        user ? eq(auditLog.actorId, user.id) : undefined,
        gte(auditLog.occurredAt, since),
      ),
    )
    .limit(1);
  if (recent) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await executeCommand(db, agg, id, command, metaFrom(c));
      return;
    } catch (err) {
      if (!(err instanceof ConcurrencyError) || attempt === 3) {
        console.warn(`[api] ${c.get("requestId")} could not record ${eventType} for ${id}:`, err instanceof Error ? err.message : err);
        return;
      }
    }
  }
}
