import type { PromptRule, PromptSection } from "@app/domain";

export interface AuditModelRequest {
  systemPrompt: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
  /** Sampling temperature; providers default to 0 for the audit itself. */
  temperature?: number;
  /** Extra context for the stub; real providers ignore it. */
  context: { agreementTitle: string; agreementFileName: string; rules: PromptRule[]; sections: PromptSection[] };
}

export type AuditModelErrorCode = "timeout" | "auth" | "http" | "invalid_json" | "process" | "refused";

export interface AuditModelResult {
  ok: boolean;
  /** Parsed JSON answer when the call succeeded; not yet schema-validated. */
  output: unknown;
  error: string | null;
  errorCode: AuditModelErrorCode | null;
  /** True when trying again later may succeed (rate limits, timeouts, 5xx). */
  retryable: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  numTurns: number;
  model: string | null;
  sessionId: string | null;
  /** Provider response kept for debugging; stored next to the prompt. */
  raw: unknown;
}

export interface AuditModelClient {
  /** Provider and model, e.g. "openrouter/deepseek/deepseek-v4-flash-0731". Recorded on every run. */
  readonly label: string;
  audit(req: AuditModelRequest): Promise<AuditModelResult>;
}

export const emptyUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  numTurns: 0,
  sessionId: null,
};

export function failure(
  errorCode: AuditModelErrorCode,
  error: string,
  retryable: boolean,
  durationMs: number,
  extra: Partial<AuditModelResult> = {},
): AuditModelResult {
  return { ok: false, output: null, error, errorCode, retryable, durationMs, model: null, raw: null, ...emptyUsage, ...extra };
}

/** Parses a JSON answer, tolerating a surrounding markdown code fence. */
export function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("Answer is not JSON");
  }
}
