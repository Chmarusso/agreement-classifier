import { type AuditModelClient, type AuditModelRequest, type AuditModelResult, failure, parseJsonAnswer } from "./types.ts";

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731";

export type OpenRouterReasoning = "off" | "low" | "provider-default";

interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  /**
   * "off" (default) disables thinking: on DeepSeek V4 Flash it halved latency and
   * cost with the same findings. Use "provider-default" for models that reject the parameter.
   */
  reasoning?: OpenRouterReasoning;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { code?: number; message?: string };
}

/** Cheap placeholder provider: OpenAI-compatible chat completions with a JSON schema response format. */
export class OpenRouterAuditClient implements AuditModelClient {
  readonly label: string;
  private readonly model: string;

  constructor(private readonly opts: OpenRouterOptions) {
    this.model = opts.model ?? DEFAULT_OPENROUTER_MODEL;
    this.label = `openrouter/${this.model}`;
  }

  async audit(req: AuditModelRequest): Promise<AuditModelResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(req.timeoutMs),
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
          "x-title": "Agreement Audit",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.prompt },
          ],
          response_format: { type: "json_schema", json_schema: { name: "audit_output", strict: false, schema: req.jsonSchema } },
          provider: { require_parameters: true },
          ...reasoningParam(this.opts.reasoning ?? "off"),
          usage: { include: true },
          temperature: req.temperature ?? 0,
        }),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return failure(timedOut ? "timeout" : "http", timedOut ? `No answer within ${req.timeoutMs} ms` : String(err), true, elapsed());
    }

    const body = (await res.json().catch(() => ({}))) as ChatResponse;
    const usage = {
      costUsd: body.usage?.cost ?? 0,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
      numTurns: 1,
      sessionId: body.id ?? null,
      model: body.model ?? this.model,
      raw: body,
    };
    if (!res.ok || body.error) {
      const status = body.error?.code ?? res.status;
      const message = body.error?.message ?? `HTTP ${res.status}`;
      return failure(
        status === 401 || status === 403 ? "auth" : "http",
        `OpenRouter ${status}: ${message}`,
        status === 429 || status >= 500,
        elapsed(),
        usage,
      );
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) return failure("invalid_json", "The model returned an empty answer.", true, elapsed(), usage);
    try {
      return {
        ok: true,
        output: parseJsonAnswer(content),
        error: null,
        errorCode: null,
        retryable: false,
        durationMs: elapsed(),
        ...usage,
      };
    } catch {
      return { ...failure("invalid_json", "The model answer is not valid JSON.", true, elapsed(), usage), output: content };
    }
  }
}

function reasoningParam(mode: OpenRouterReasoning): Record<string, unknown> {
  if (mode === "off") return { reasoning: { enabled: false } };
  if (mode === "low") return { reasoning: { effort: "low", exclude: true } };
  return {};
}
