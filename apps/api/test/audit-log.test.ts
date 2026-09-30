import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuditLogEntryDto, AuditLogPage, DashboardDto, EventTypesDto, HealthDto } from "@app/contracts";
import { createHarness } from "./harness.ts";

let h: Awaited<ReturnType<typeof createHarness>>;
let admin: string;
beforeAll(async () => {
  h = await createHarness();
  await h.login("viewer@example.com"); // a second login, so event-type filters have more than one hit
  admin = await h.login("admin@example.com");
  for (let i = 0; i < 5; i++) {
    await h.call("POST", "/users", { cookie: admin, body: { email: `page${i}@example.com`, displayName: `P${i}`, role: "viewer" } });
  }
});
afterAll(async () => {
  await h.close();
});

const page = async (qs: string) => (await (await h.call("GET", `/audit-log?${qs}`, { cookie: admin })).json()) as AuditLogPage;

describe("audit log API", () => {
  test("requires login", async () => {
    expect((await h.call("GET", "/audit-log")).status).toBe(401);
  });

  test("lists newest first with actor and summary", async () => {
    const { items } = await page("limit=3");
    expect(items).toHaveLength(3);
    expect(items[0]!.globalPosition).toBeGreaterThan(items[1]!.globalPosition);
    expect(items[0]).toMatchObject({
      eventType: "UserRegistered",
      actorLabel: "admin@example.com",
      summary: "page4@example.com registered as viewer",
    });
  });

  test("filters by event type", async () => {
    const { items } = await page("eventType=OtpVerified&limit=50");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(new Set(items.map((i) => i.eventType))).toEqual(new Set(["OtpVerified"]));
  });

  test("filters by actor", async () => {
    const me = (await (await h.call("GET", "/auth/me", { cookie: admin })).json()) as { id: string };
    const { items } = await page(`actorId=${me.id}`);
    expect(items.every((i) => i.actorId === me.id)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test("filters by date range", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await page(`from=${encodeURIComponent(future)}`)).items).toEqual([]);
  });

  test("cursor pagination walks every row exactly once", async () => {
    const all = await page("limit=200");
    const seen: number[] = [];
    let cursor: number | null = null;
    do {
      const p: AuditLogPage = await page(`limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...p.items.map((i) => i.globalPosition));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((i) => i.globalPosition));
  });

  test("actors endpoint lists distinct actors", async () => {
    const actors = (await (await h.call("GET", "/audit-log/actors", { cookie: admin })).json()) as { id: string; label: string }[];
    expect(actors.map((a) => a.label)).toContain("admin@example.com");
    expect(new Set(actors.map((a) => a.id)).size).toBe(actors.length);
  });

  test("invalid filter value is a 422", async () => {
    expect((await h.call("GET", "/audit-log?limit=5000", { cookie: admin })).status).toBe(422);
  });

  test("single event by id", async () => {
    const [first] = (await page("limit=1")).items;
    const res = await h.call("GET", `/audit-log/${first!.eventId}`, { cookie: admin });
    expect(((await res.json()) as AuditLogEntryDto).eventId).toBe(first!.eventId);
  });

  test("SSE stream delivers a newly appended event", async () => {
    const res = await h.call("GET", "/audit-log/stream", { cookie: admin });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}; got ${buffer}`);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
    };
    await readUntil("event: ready");
    await h.call("POST", "/users", { cookie: admin, body: { email: "sse@example.com", displayName: "S", role: "viewer" } });
    await readUntil("sse@example.com registered as viewer");
    await reader.cancel();
  });
});

describe("system endpoints", () => {
  test("health reports db ok and a missing worker", async () => {
    const res = await h.call("GET", "/health");
    expect(res.status).toBe(200);
    expect((await res.json()) as HealthDto).toMatchObject({ db: "ok", status: "degraded", worker: { status: "missing" } });
  });

  test("event types catalogue lists stream types", async () => {
    const body = (await (await h.call("GET", "/system/event-types", { cookie: admin })).json()) as EventTypesDto;
    expect(body.eventTypes).toContainEqual({ type: "UserRegistered", streamType: "User" });
    expect(body.streamTypes).toContain("System");
  });

  test("dashboard counts users and events", async () => {
    const body = (await (await h.call("GET", "/dashboard", { cookie: admin })).json()) as DashboardDto;
    expect(body.users.total).toBeGreaterThanOrEqual(8);
    expect(body.events.total).toBeGreaterThan(body.users.total);
    expect(body.recent.length).toBeGreaterThan(0);
  });
});

describe("view events", () => {
  test("repeated views within five minutes record one event", async () => {
    const admin = await h.login("admin@example.com");
    const { seedAllRules } = await import("@app/seeds/catalog");
    await seedAllRules(h.t);
    const rules = (await (await h.call("GET", "/rules", { cookie: admin })).json()) as { id: string }[];
    const id = rules[0]!.id;
    for (let i = 0; i < 4; i++) expect((await h.call("GET", `/rules/${id}`, { cookie: admin })).status).toBe(200);
    const log = (await (await h.call("GET", `/audit-log?streamId=${id}&includeReads=true`, { cookie: admin })).json()) as AuditLogPage;
    expect(log.items.filter((i) => i.eventType === "RuleViewed")).toHaveLength(1);
  });
});
