import { type AuditModelClient, type AuditModelRequest, type AuditModelResult, failure } from "./types.ts";

export type StubResponder = (req: AuditModelRequest, callNo: number) => unknown;

/**
 * Deterministic provider for tests, seeds and demos. The responder returns the
 * answer object; returning an Error simulates a provider failure.
 */
export class StubAuditClient implements AuditModelClient {
  readonly label = "stub";
  calls = 0;
  constructor(private readonly responder: StubResponder) {}

  async audit(req: AuditModelRequest): Promise<AuditModelResult> {
    this.calls++;
    const out = this.responder(req, this.calls);
    if (out instanceof Error) return failure("process", out.message, true, 5);
    return {
      ok: true,
      output: out,
      error: null,
      errorCode: null,
      retryable: false,
      costUsd: 0,
      inputTokens: Math.ceil((req.systemPrompt.length + req.prompt.length) / 4),
      outputTokens: Math.ceil(JSON.stringify(out).length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 5,
      numTurns: 1,
      model: "stub",
      sessionId: null,
      raw: out,
    };
  }
}

/** Answers every rule with `pass`. Used when no fixture matches. */
export const allPassResponder: StubResponder = (req) => ({
  schemaVersion: 1,
  summary: `Stub audit of ${req.context.agreementTitle}: every rule passes.`,
  agreementMetadata: { title: req.context.agreementTitle, parties: [], effectiveDate: null, governingLaw: null },
  findings: req.context.rules.map((r) => ({
    ruleId: r.id,
    status: "pass",
    confidence: 0.5,
    explanation: "Stub answer.",
    evidence: [],
    recommendation: null,
  })),
});
