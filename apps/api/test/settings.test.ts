import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgreementDto, AuditLogPage, AuditModelSettingsDto, AuditRunSummaryDto, DashboardDto } from "@app/contracts";
import { rebuildProjections } from "@app/db";
import { environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fixtureResponder } from "@app/seeds/stub";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness, errorOf } from "./harness.ts";

let h: Awaited<ReturnType<typeof createHarness>>;
let admin: string;
let auditor: string;
let viewer: string;
let worker: Worker;
const stub = new StubAuditClient(fixtureResponder);
beforeAll(async () => {
  h = await createHarness();
  await seedAllRules(h.t);
  admin = await h.login("admin@example.com");
  auditor = await h.login("auditor@example.com");
  viewer = await h.login("viewer@example.com");
  worker = new Worker({
    database: h.t,
    workerId: "settings-test-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({})),
      run_audit: runAuditHandler(async () => stub),
    },
  });
});
afterAll(async () => {
  await h.close();
});

const settings = async (cookie = admin) =>
  (await (await h.call("GET", "/settings/audit-model", { cookie })).json()) as AuditModelSettingsDto;

describe("admin-only endpoints", () => {
  const adminOnly = ["/settings/audit-model", "/audits/costs", "/audit-log", "/audit-log/actors", "/system/event-types"];
  for (const path of adminOnly) {
    test(`${path} is 403 for auditor and viewer`, async () => {
      expect((await h.call("GET", path, { cookie: auditor })).status).toBe(403);
      expect((await h.call("GET", path, { cookie: viewer })).status).toBe(403);
      expect((await h.call("GET", path, { cookie: admin })).status).toBe(200);
    });
  }

  test("dashboard hides recent events from non-admins but shares verdict counts", async () => {
    const forViewer = (await (await h.call("GET", "/dashboard", { cookie: viewer })).json()) as DashboardDto;
    expect(forViewer.recent).toEqual([]);
    expect(forViewer.verdicts).toMatchObject({ pass: 0, warn: 0, fail: 0 });
  });
});

describe("audit model settings", () => {
  test("starts from the environment default with provider availability", async () => {
    const s = await settings();
    expect(s.current).toMatchObject({ provider: "stub", label: "stub", source: "environment" });
    expect(s.version).toBe(0);
    expect(s.providers.find((p) => p.id === "stub")).toMatchObject({ available: true });
    expect(s.providers.find((p) => p.id === "openrouter")).toMatchObject({ available: false });
  });

  test("an unavailable provider is rejected with a field error", async () => {
    const res = await h.call("PUT", "/settings/audit-model", { cookie: admin, body: { provider: "openrouter", version: 0 } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details[0]?.path).toBe("provider");
  });

  test("admin sets the model, new audits record it, stale versions conflict, reset restores the default", async () => {
    const set = await h.call("PUT", "/settings/audit-model", {
      cookie: admin,
      body: { provider: "claude-cli", model: "sonnet", version: 0 },
    });
    expect(set.status).toBe(200);
    const s1 = (await set.json()) as AuditModelSettingsDto;
    expect(s1.current).toMatchObject({ provider: "claude-cli", model: "sonnet", label: "claude-cli/sonnet", source: "admin" });
    expect(s1.version).toBe(1);
    expect((await settings()).current.label).toBe("claude-cli/sonnet");

    const a = (await (await h.upload("nda-compliant.pdf", "NDA", auditor)).json()) as AgreementDto;
    await worker.drain();
    const run = (await (await h.call("POST", `/agreements/${a.id}/audits`, { cookie: admin, body: {} })).json()) as AuditRunSummaryDto;
    expect(run.model).toBe("claude-cli/sonnet");
    const requested = (await (
      await h.call("GET", `/audit-log?streamId=${run.id}&eventType=AuditRunRequested`, { cookie: admin })
    ).json()) as AuditLogPage;
    expect((requested.items[0]!.payload as { modelConfig: unknown }).modelConfig).toEqual({
      provider: "claude-cli",
      model: "sonnet",
      reasoning: "off",
    });

    const stale = await h.call("PUT", "/settings/audit-model", { cookie: admin, body: { provider: "stub", version: 0 } });
    expect(stale.status).toBe(409);

    const log = (await (await h.call("GET", "/audit-log?streamType=System", { cookie: admin })).json()) as AuditLogPage;
    expect(log.items.some((e) => e.eventType === "AuditModelConfigured" && e.summary === "Audit model set to claude-cli/sonnet")).toBe(
      true,
    );

    await rebuildProjections(h.t.db);
    expect((await settings()).current).toMatchObject({ label: "claude-cli/sonnet", source: "admin" });

    const reset = await h.call("POST", "/settings/audit-model/reset", { cookie: admin, body: { version: 1 } });
    expect(reset.status).toBe(200);
    const s2 = (await reset.json()) as AuditModelSettingsDto;
    expect(s2.current).toMatchObject({ label: "stub", source: "environment" });
    expect(s2.version).toBe(2);
  });
});
