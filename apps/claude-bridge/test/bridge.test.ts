import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeAuditClient } from "@app/llm";
import { startBridge } from "../src/server.ts";

const token = "test-bridge-token-123456";
const socketPath = join(mkdtempSync(join(tmpdir(), "bridge-")), "b.sock");
let bridge: ReturnType<typeof startBridge>;
const req = {
  systemPrompt: "s",
  prompt: "p",
  jsonSchema: {},
  timeoutMs: 3000,
  context: { agreementTitle: "", agreementFileName: "", rules: [], sections: [] },
};

beforeAll(() => {
  process.env.FAKE_CLAUDE_SCENARIO = "valid";
  bridge = startBridge({
    token,
    socketPath,
    port: 0,
    model: "opus",
    binary: join(import.meta.dir, "../../../packages/llm/test/fixtures/fake-claude.sh"),
  });
});
afterAll(() => bridge.stop());

test("worker client reaches the bridge over TCP", async () => {
  const r = await new BridgeAuditClient({ url: `http://127.0.0.1:${bridge.port}`, token }).audit(req);
  expect(r).toMatchObject({ ok: true, costUsd: 0.0123 });
});

test("worker client reaches the bridge over the unix socket", async () => {
  const r = await new BridgeAuditClient({ url: `unix://${socketPath}`, token }).audit(req);
  expect(r).toMatchObject({ ok: true, output: { ok: true } });
});

test("wrong token is rejected", async () => {
  const r = await new BridgeAuditClient({ url: `http://127.0.0.1:${bridge.port}`, token: "wrong-token-wrong-token" }).audit(req);
  expect(r).toMatchObject({ ok: false, errorCode: "auth" });
});

test("unreachable bridge is a retryable failure", async () => {
  const r = await new BridgeAuditClient({ url: "http://127.0.0.1:1", token }).audit(req);
  expect(r).toMatchObject({ ok: false, errorCode: "http", retryable: true });
});
