import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ClaudeCliAuditClient } from "../src/claude-cli.ts";

const binary = join(import.meta.dir, "fixtures/fake-claude.sh");
const req = {
  systemPrompt: "sys",
  prompt: "p",
  jsonSchema: { type: "object" },
  timeoutMs: 3000,
  context: { agreementTitle: "t", agreementFileName: "f", rules: [], sections: [] },
};
const run = (scenario: string, timeoutMs = 3000) =>
  new ClaudeCliAuditClient({ binary, env: { FAKE_CLAUDE_SCENARIO: scenario } }).audit({ ...req, timeoutMs });

describe("claude CLI client (fake binary)", () => {
  test("passes the lean headless flags", () => {
    const args = new ClaudeCliAuditClient({ model: "opus" }).args(req);
    for (const flag of [
      "-p",
      "--json-schema",
      "--tools",
      "--setting-sources",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  test("valid envelope: structured output, cost and token counts", async () => {
    expect(await run("valid")).toMatchObject({
      ok: true,
      output: { ok: true },
      costUsd: 0.0123,
      inputTokens: 1010,
      outputTokens: 50,
      cacheWriteTokens: 1000,
      model: "claude-opus-5",
    });
  });

  test("not logged in is a non-retryable auth failure", async () => {
    expect(await run("not_logged_in")).toMatchObject({ ok: false, errorCode: "auth", retryable: false });
  });

  test("missing structured_output is invalid_json and keeps the cost", async () => {
    expect(await run("no_structured")).toMatchObject({ ok: false, errorCode: "invalid_json", costUsd: 0.002 });
  });

  test("non-JSON output with a crash is a process failure", async () => {
    const r = await run("garbage");
    expect(r).toMatchObject({ ok: false, errorCode: "process" });
    expect(r.error).toContain("Traceback");
  });

  test("a hung process is killed at the timeout", async () => {
    expect(await run("slow", 300)).toMatchObject({ ok: false, errorCode: "timeout", retryable: true });
  });
});
