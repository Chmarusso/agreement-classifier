import { describeEvent, readEventTypes, type StoredEvent } from "@app/domain";
import { eq } from "drizzle-orm";
import type { Tx } from "../client.ts";
import { agreements, auditLog, auditRuns, rules, users } from "../schema.ts";

async function userLabel(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, id));
  return u?.email ?? null;
}

async function entityLabel(tx: Tx, e: StoredEvent): Promise<string | null> {
  switch (e.streamType) {
    case "User":
    case "UserAuth":
      return userLabel(tx, e.streamId);
    case "Rule": {
      const [r] = await tx.select({ title: rules.title }).from(rules).where(eq(rules.id, e.streamId));
      return r ? `"${r.title}"` : null;
    }
    case "Agreement": {
      const [a] = await tx.select({ title: agreements.title }).from(agreements).where(eq(agreements.id, e.streamId));
      return a?.title ?? null;
    }
    case "AuditRun": {
      const [r] = await tx
        .select({ title: agreements.title })
        .from(auditRuns)
        .innerJoin(agreements, eq(agreements.id, auditRuns.agreementId))
        .where(eq(auditRuns.id, e.streamId));
      return r?.title ?? null;
    }
    case "System":
      return "workerId" in e.payload ? `worker ${e.payload.workerId}` : "system";
    default:
      return null;
  }
}

function actorFallback(e: StoredEvent): string {
  switch (e.metadata.actorType) {
    case "worker":
      return "worker";
    case "system":
      return "system";
    default:
      return "anonymous";
  }
}

export async function projectAuditLog(tx: Tx, e: StoredEvent): Promise<void> {
  const label = await entityLabel(tx, e);
  const actorLabel = (await userLabel(tx, e.metadata.actorUserId)) ?? actorFallback(e);
  await tx.insert(auditLog).values({
    globalPosition: e.globalPosition,
    eventId: e.eventId,
    occurredAt: e.occurredAt,
    actorId: e.metadata.actorUserId,
    actorLabel,
    actorType: e.metadata.actorType,
    eventType: e.type,
    streamType: e.streamType,
    streamId: e.streamId,
    entityLabel: label,
    summary: describeEvent(e, label),
    isRead: readEventTypes.has(e.type),
    payload: e.payload,
    metadata: e.metadata,
  });
}
