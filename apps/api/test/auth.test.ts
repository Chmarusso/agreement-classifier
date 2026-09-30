import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { events } from "@app/db";
import { and, eq, sql } from "drizzle-orm";
import { loadConfig } from "../src/config.ts";
import { createHarness, errorOf } from "./harness.ts";

let h: Awaited<ReturnType<typeof createHarness>>;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const countEvents = async (type: string) =>
  (await h.t.db.select({ n: sql<number>`count(*)::int` }).from(events).where(eq(events.eventType, type)))[0]!.n;

describe("config", () => {
  test("refuses to boot with a dev OTP code in production", () => {
    expect(() =>
      loadConfig({
        APP_ENV: "production",
        DATABASE_URL: "postgres://x@y/z",
        AUTH_SECRET: "a-real-secret-value-123",
        DEV_OTP_CODE: "000000",
      }),
    ).toThrow(/DEV_OTP_CODE/);
  });
  test("boots in production without a dev code", () => {
    expect(
      loadConfig({ APP_ENV: "production", DATABASE_URL: "postgres://x@y/z", AUTH_SECRET: "a-real-secret-value-123" }).devOtpCode,
    ).toBeNull();
  });
});

describe("OTP login", () => {
  test("unknown email gets 202 and no event", async () => {
    const before = await countEvents("OtpRequested");
    const res = await h.call("POST", "/auth/otp/request", { body: { email: "nobody@example.com" } });
    expect(res.status).toBe(202);
    expect(await countEvents("OtpRequested")).toBe(before);
  });

  test("real code flow: request, receive, verify, cookie, me", async () => {
    const res = await h.call("POST", "/auth/otp/request", { body: { email: "auditor@example.com" } });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "sent", devCodeHint: "000000" });
    const code = h.otp.lastCodeFor("auditor@example.com");
    expect(code).toMatch(/^\d{6}$/);

    const cookie = await h.login("auditor@example.com", code!);
    expect(cookie).toStartWith("sid=");
    const me = await h.call("GET", "/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "auditor@example.com", role: "auditor" });
  });

  test("session cookie is httpOnly and SameSite=Lax", async () => {
    const res = await h.call("POST", "/auth/otp/verify", { body: { email: "viewer@example.com", code: "000000" } });
    const header = res.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  test("dev code logs in and is flagged in the event", async () => {
    await h.login("admin@example.com");
    const [row] = await h.t.db
      .select()
      .from(events)
      .where(and(eq(events.eventType, "OtpVerified"), sql`payload->>'usedDevCode' = 'true'`))
      .limit(1);
    expect(row).toBeTruthy();
  });

  test("wrong code returns 401 and records OtpVerificationFailed", async () => {
    await h.call("POST", "/auth/otp/request", { body: { email: "viewer@example.com" } });
    const before = await countEvents("OtpVerificationFailed");
    const res = await h.call("POST", "/auth/otp/verify", { body: { email: "viewer@example.com", code: "123123" } });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("UNAUTHORIZED");
    expect(await countEvents("OtpVerificationFailed")).toBe(before + 1);
  });

  test("five wrong codes lock the account, even against the correct code", async () => {
    const email = "locktest@example.com";
    const admin = await h.login("admin@example.com");
    await h.call("POST", "/users", { cookie: admin, body: { email, displayName: "Lock", role: "viewer" } });
    await h.call("POST", "/auth/otp/request", { body: { email } });
    const good = h.otp.lastCodeFor(email)!;
    const wrong = good === "111111" ? "222222" : "111111";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await h.call("POST", "/auth/otp/verify", { body: { email, code: wrong } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const locked = await h.call("POST", "/auth/otp/verify", { body: { email, code: good } });
    expect(locked.status).toBe(429);
  });

  test("malformed code is a 422 with field details", async () => {
    const res = await h.call("POST", "/auth/otp/verify", { body: { email: "admin@example.com", code: "12" } });
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details[0]?.path).toBe("code");
  });

  test("logout revokes the session and emits UserLoggedOut", async () => {
    const cookie = await h.login("viewer@example.com");
    const before = await countEvents("UserLoggedOut");
    expect((await h.call("POST", "/auth/logout", { cookie })).status).toBe(204);
    expect(await countEvents("UserLoggedOut")).toBe(before + 1);
    expect((await h.call("GET", "/auth/me", { cookie })).status).toBe(401);
  });
});

describe("errors and correlation", () => {
  test("error envelope carries code, message and requestId matching the header", async () => {
    const res = await h.call("GET", "/auth/me");
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err).toMatchObject({ code: "UNAUTHORIZED", message: expect.any(String), details: [] });
    expect(err.requestId).toBe(res.headers.get("x-request-id")!);
  });

  test("unknown route returns the envelope with 404", async () => {
    const res = await h.call("GET", "/nope");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
  });

  test("invalid JSON body is a 422", async () => {
    const res = await h.call("POST", "/auth/otp/request", { body: "{not json" });
    expect(res.status).toBe(422);
  });

  test("the request id becomes the event correlation id", async () => {
    const admin = await h.login("admin@example.com");
    const requestId = `req-${crypto.randomUUID()}`;
    const res = await h.call("POST", "/users", {
      cookie: admin,
      headers: { "x-request-id": requestId },
      body: { email: "corr@example.com", displayName: "Corr", role: "viewer" },
    });
    expect(res.status).toBe(201);
    const [row] = await h.t.db.select().from(events).where(sql`metadata->>'correlationId' = ${requestId}`);
    expect(row?.eventType).toBe("UserRegistered");
  });
});
