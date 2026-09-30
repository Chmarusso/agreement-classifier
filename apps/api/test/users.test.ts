import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { UserDto } from "@app/contracts";
import { createHarness, errorOf } from "./harness.ts";

let h: Awaited<ReturnType<typeof createHarness>>;
let admin: string;
beforeAll(async () => {
  h = await createHarness();
  admin = await h.login("admin@example.com");
});
afterAll(async () => {
  await h.close();
});

describe("user management", () => {
  test("viewer gets 403 on admin endpoints", async () => {
    const viewer = await h.login("viewer@example.com");
    const res = await h.call("GET", "/users", { cookie: viewer });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("FORBIDDEN");
  });

  test("auditor gets 403 too", async () => {
    const auditor = await h.login("auditor@example.com");
    expect(
      (await h.call("POST", "/users", { cookie: auditor, body: { email: "x@example.com", displayName: "X", role: "viewer" } })).status,
    ).toBe(403);
  });

  test("anonymous gets 401", async () => {
    expect((await h.call("GET", "/users")).status).toBe(401);
  });

  test("admin invites, changes role, deactivates, reactivates", async () => {
    const created = await h.call("POST", "/users", {
      cookie: admin,
      body: { email: "New@Example.com", displayName: "New", role: "viewer" },
    });
    expect(created.status).toBe(201);
    const u = (await created.json()) as UserDto;
    expect(u).toMatchObject({ email: "new@example.com", role: "viewer", status: "active", version: 1 });

    const role = await h.call("PATCH", `/users/${u.id}/role`, { cookie: admin, body: { role: "auditor", version: 1 } });
    expect(await role.json()).toMatchObject({ role: "auditor", version: 2 });

    const deact = await h.call("POST", `/users/${u.id}/deactivate`, { cookie: admin, body: { reason: "left", version: 2 } });
    expect(await deact.json()).toMatchObject({ status: "deactivated", version: 3 });

    const login = await h.call("POST", "/auth/otp/verify", { body: { email: "new@example.com", code: "000000" } });
    expect(login.status).toBe(401);

    const react = await h.call("POST", `/users/${u.id}/reactivate`, { cookie: admin, body: { version: 3 } });
    expect(await react.json()).toMatchObject({ status: "active", version: 4 });
  });

  test("duplicate email is a 409 with a field detail", async () => {
    const res = await h.call("POST", "/users", { cookie: admin, body: { email: "viewer@example.com", displayName: "V", role: "viewer" } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).details).toEqual([{ path: "email", message: "Already registered" }]);
  });

  test("stale version is a 409 conflict", async () => {
    const list = (await (await h.call("GET", "/users", { cookie: admin })).json()) as UserDto[];
    const viewer = list.find((u) => u.email === "viewer@example.com")!;
    const res = await h.call("PATCH", `/users/${viewer.id}/role`, {
      cookie: admin,
      body: { role: "auditor", version: viewer.version + 7 },
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("CONFLICT");
  });

  test("admin cannot deactivate themselves", async () => {
    const me = (await (await h.call("GET", "/auth/me", { cookie: admin })).json()) as { id: string };
    const res = await h.call("POST", `/users/${me.id}/deactivate`, { cookie: admin, body: { reason: null, version: 1 } });
    expect(res.status).toBe(409);
  });

  test("deactivation revokes existing sessions", async () => {
    const created = (await (
      await h.call("POST", "/users", { cookie: admin, body: { email: "kick@example.com", displayName: "K", role: "viewer" } })
    ).json()) as UserDto;
    const cookie = await h.login("kick@example.com");
    expect((await h.call("GET", "/auth/me", { cookie })).status).toBe(200);
    await h.call("POST", `/users/${created.id}/deactivate`, { cookie: admin, body: { reason: null, version: created.version } });
    expect((await h.call("GET", "/auth/me", { cookie })).status).toBe(401);
  });

  test("invalid id in path is a 404", async () => {
    expect((await h.call("PATCH", "/users/not-a-uuid/role", { cookie: admin, body: { role: "viewer", version: 1 } })).status).toBe(404);
  });
});
