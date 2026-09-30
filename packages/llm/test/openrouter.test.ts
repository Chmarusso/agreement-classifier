import { expect, test } from "bun:test";
import { OpenRouterAuditClient } from "../src/openrouter.ts";

const req = {
  systemPrompt: "sys",
  prompt: "p",
  jsonSchema: { type: "object" },
  timeoutMs: 5000,
  context: { agreementTitle: "t", agreementFileName: "f", rules: [], sections: [] },
};

function fakeFetch(status: number, body: unknown, seen: { body?: Record<string, unknown> } = {}) {
  return (async (_url: string, init: RequestInit) => {
    seen.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("maps answer, cost and tokens; sends schema and reasoning off", async () => {
  const seen: { body?: Record<string, unknown> } = {};
  const client = new OpenRouterAuditClient({
    apiKey: "k",
    fetch: fakeFetch(
      200,
      {
        id: "gen-1",
        model: "m",
        choices: [{ message: { content: '```json\n{"a":1}\n```' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00042 },
      },
      seen,
    ),
  });
  const r = await client.audit(req);
  expect(r).toMatchObject({ ok: true, output: { a: 1 }, costUsd: 0.00042, inputTokens: 10, outputTokens: 5, sessionId: "gen-1" });
  expect(seen.body).toMatchObject({ reasoning: { enabled: false }, usage: { include: true }, response_format: { type: "json_schema" } });
  expect(client.label).toBe("openrouter/deepseek/deepseek-v4-flash-0731");
});

test("401 is a non-retryable auth failure", async () => {
  const r = await new OpenRouterAuditClient({ apiKey: "bad", fetch: fakeFetch(401, { error: { code: 401, message: "No auth" } }) }).audit(
    req,
  );
  expect(r).toMatchObject({ ok: false, errorCode: "auth", retryable: false });
});

test("429 and 5xx are retryable", async () => {
  for (const code of [429, 502]) {
    const r = await new OpenRouterAuditClient({ apiKey: "k", fetch: fakeFetch(code, { error: { code, message: "busy" } }) }).audit(req);
    expect(r.retryable).toBe(true);
  }
});

test("prose instead of JSON is an invalid_json failure that keeps the cost", async () => {
  const r = await new OpenRouterAuditClient({
    apiKey: "k",
    fetch: fakeFetch(200, {
      choices: [{ message: { content: "Sorry, I cannot." } }],
      usage: { cost: 0.0001, prompt_tokens: 1, completion_tokens: 1 },
    }),
  }).audit(req);
  expect(r).toMatchObject({ ok: false, errorCode: "invalid_json", costUsd: 0.0001 });
});
