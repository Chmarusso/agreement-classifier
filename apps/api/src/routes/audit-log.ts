import type { AuditActorDto } from "@app/contracts";
import { type AuditLogPage, AuditLogQuery } from "@app/contracts";
import { auditLog } from "@app/db";
import { AppError } from "@app/domain";
import { and, asc, desc, eq, gte, isNotNull, lt, lte, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireRole } from "../lib/auth.ts";
import type { Deps, Env } from "../lib/context.ts";
import { toAuditLogDto } from "../lib/dto.ts";
import { parseQuery, parseUuidParam } from "../lib/validate.ts";

export function auditLogRoutes(deps: Deps) {
  const { db } = deps.database;
  return new Hono<Env>()
    .use(requireRole("admin"))
    .get("/", async (c) => {
      const q = parseQuery(c, AuditLogQuery);
      const where: SQL[] = [];
      if (q.from) where.push(gte(auditLog.occurredAt, new Date(q.from)));
      if (q.to) where.push(lte(auditLog.occurredAt, new Date(q.to)));
      if (q.eventType) where.push(eq(auditLog.eventType, q.eventType));
      if (q.streamType) where.push(eq(auditLog.streamType, q.streamType));
      if (q.streamId) where.push(eq(auditLog.streamId, q.streamId));
      if (q.actorId) where.push(eq(auditLog.actorId, q.actorId));
      if (q.includeReads !== "true") where.push(eq(auditLog.isRead, false));
      if (q.cursor) where.push(lt(auditLog.globalPosition, q.cursor));

      const rows = await db
        .select()
        .from(auditLog)
        .where(and(...where))
        .orderBy(desc(auditLog.globalPosition))
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit).map(toAuditLogDto);
      const page: AuditLogPage = {
        items,
        nextCursor: rows.length > q.limit ? (items.at(-1)?.globalPosition ?? null) : null,
      };
      return c.json(page);
    })
    .get("/actors", async (c) => {
      const rows = await db
        .selectDistinct({ id: auditLog.actorId, label: auditLog.actorLabel })
        .from(auditLog)
        .where(isNotNull(auditLog.actorId))
        .orderBy(asc(auditLog.actorLabel));
      const body: AuditActorDto[] = rows.map((r) => ({ id: r.id!, label: r.label }));
      return c.json(body);
    })
    .get("/stream", (c) => {
      const includeReads = c.req.query("includeReads") === "true";
      return streamSSE(c, async (stream) => {
        const unsubscribe = deps.broadcaster.subscribe((entry) => {
          if (!includeReads && entry.isRead) return;
          void stream.writeSSE({ event: "audit", id: String(entry.globalPosition), data: JSON.stringify(entry) });
        });
        stream.onAbort(unsubscribe);
        await stream.writeSSE({ event: "ready", data: "" });
        while (!stream.aborted) {
          await stream.sleep(15_000);
          if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
        }
        unsubscribe();
      });
    })
    .get("/:eventId", async (c) => {
      const id = parseUuidParam(c, "eventId");
      const [row] = await db.select().from(auditLog).where(eq(auditLog.eventId, id));
      if (!row) throw new AppError("NOT_FOUND", "Event not found.");
      return c.json(toAuditLogDto(row));
    });
}
