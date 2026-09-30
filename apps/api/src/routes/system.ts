import type { DashboardDto, EventTypesDto, HealthDto } from "@app/contracts";
import { agreements, auditLog, events, rules, users, workerHeartbeats } from "@app/db";
import { eventRegistry, streamTypes } from "@app/domain";
import { count, desc, eq, gte, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { seesCosts, verdictCounts } from "../lib/audit-model.ts";
import { requireRole, requireUser } from "../lib/auth.ts";
import type { Deps, Env } from "../lib/context.ts";
import { toAuditLogDto } from "../lib/dto.ts";

const WORKER_STALE_SECONDS = 60;

export function systemRoutes(deps: Deps) {
  const { db } = deps.database;
  return new Hono<Env>()
    .get("/health", async (c) => {
      let dbOk = true;
      let lastSeen: Date | null = null;
      try {
        await db.execute(sql`select 1`);
        const [hb] = await db.select({ m: max(workerHeartbeats.lastSeenAt) }).from(workerHeartbeats);
        lastSeen = hb?.m ?? null;
      } catch {
        dbOk = false;
      }
      const age = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 1000) : null;
      const worker: HealthDto["worker"] = {
        lastSeenAt: lastSeen?.toISOString() ?? null,
        ageSeconds: age,
        status: age === null ? "missing" : age > WORKER_STALE_SECONDS ? "stale" : "ok",
      };
      const body: HealthDto = {
        status: dbOk && worker.status === "ok" ? "ok" : "degraded",
        db: dbOk ? "ok" : "down",
        worker,
      };
      return c.json(body, dbOk ? 200 : 503);
    })
    .get("/system/event-types", requireRole("admin"), (c) => {
      const body: EventTypesDto = {
        eventTypes: Object.entries(eventRegistry).map(([type, def]) => ({ type, streamType: def.stream })),
        streamTypes: [...streamTypes],
      };
      return c.json(body);
    })
    .get("/dashboard", requireUser, async (c) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const admin = seesCosts(c);
      const [[u], [ua], [e], [e24], recent, [ra], [ag], verdicts] = await Promise.all([
        db.select({ n: count() }).from(users),
        db.select({ n: count() }).from(users).where(eq(users.status, "active")),
        db.select({ n: count() }).from(events),
        db.select({ n: count() }).from(events).where(gte(events.occurredAt, since)),
        admin ? db.select().from(auditLog).where(eq(auditLog.isRead, false)).orderBy(desc(auditLog.globalPosition)).limit(8) : [],
        db.select({ n: count() }).from(rules).where(eq(rules.status, "active")),
        db
          .select({
            n: count(),
            pass: sql<number>`count(*) filter (where ${agreements.latestVerdict} = 'pass')::int`,
            warn: sql<number>`count(*) filter (where ${agreements.latestVerdict} = 'warn')::int`,
            fail: sql<number>`count(*) filter (where ${agreements.latestVerdict} = 'fail')::int`,
          })
          .from(agreements),
        verdictCounts(deps),
      ]);
      const body: DashboardDto = {
        users: { total: u?.n ?? 0, active: ua?.n ?? 0 },
        rules: { active: ra?.n ?? 0 },
        agreements: {
          total: ag?.n ?? 0,
          byLatestVerdict: { pass: ag?.pass ?? 0, warn: ag?.warn ?? 0, fail: ag?.fail ?? 0 },
        },
        verdicts,
        events: { total: e?.n ?? 0, last24h: e24?.n ?? 0 },
        recent: recent.map(toAuditLogDto),
      };
      return c.json(body);
    });
}
