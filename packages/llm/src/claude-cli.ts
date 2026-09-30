import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditModelClient, type AuditModelRequest, type AuditModelResult, failure } from "./types.ts";

interface ClaudeEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export interface ClaudeCliOptions {
  model?: string;
  /** Path to the claude binary; tests point this at a fake. */
  binary?: string;
  maxTurns?: number;
  env?: Record<string, string | undefined>;
}

/**
 * Runs `claude -p` on the host with the logged-in CLI. Flags keep the run lean:
 * no tools, no user or project settings, no MCP servers, no session file.
 * Verified on Claude Code 2.1.282 (PLAN.md section 9.2).
 */
export class ClaudeCliAuditClient implements AuditModelClient {
  readonly label: string;
  private readonly model: string;

  constructor(private readonly opts: ClaudeCliOptions = {}) {
    this.model = opts.model ?? "opus";
    this.label = `claude-cli/${this.model}`;
  }

  args(req: AuditModelRequest): string[] {
    return [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(req.jsonSchema),
      "--system-prompt",
      req.systemPrompt,
      "--tools",
      "",
      "--max-turns",
      String(this.opts.maxTurns ?? 3),
      "--model",
      this.model,
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
  }

  async audit(req: AuditModelRequest): Promise<AuditModelResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([this.opts.binary ?? "claude", ...this.args(req)], {
        cwd: mkdtempSync(join(tmpdir(), "audit-claude-")),
        stdin: new Blob([req.prompt]),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...this.opts.env },
      });
    } catch (err) {
      return failure("process", `Could not start the claude CLI: ${String(err)}`, false, elapsed());
    }
    // Race the process against the timeout. A killed shell can leave children holding
    // stdout open, so on timeout we stop waiting instead of draining the pipes.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), req.timeoutMs);
    });
    const finished = Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    const outcome = await Promise.race([finished, timeout]);
    clearTimeout(timer);
    if (outcome === "timeout") {
      proc.kill("SIGKILL");
      return failure("timeout", `The claude CLI did not answer within ${req.timeoutMs} ms`, true, elapsed());
    }
    const [stdout, stderr, exitCode] = outcome;

    let env: ClaudeEnvelope;
    try {
      env = JSON.parse(stdout) as ClaudeEnvelope;
    } catch {
      return failure(
        "process",
        `claude exited with code ${exitCode} and no JSON output: ${(stderr || stdout).slice(0, 300)}`,
        exitCode !== 0,
        elapsed(),
      );
    }
    const usage = {
      costUsd: env.total_cost_usd ?? 0,
      inputTokens:
        (env.usage?.input_tokens ?? 0) + (env.usage?.cache_creation_input_tokens ?? 0) + (env.usage?.cache_read_input_tokens ?? 0),
      outputTokens: env.usage?.output_tokens ?? 0,
      cacheReadTokens: env.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: env.usage?.cache_creation_input_tokens ?? 0,
      numTurns: env.num_turns ?? 0,
      sessionId: env.session_id ?? null,
      model: Object.keys(env.modelUsage ?? {})[0] ?? this.model,
      raw: env,
    };
    if (env.is_error || exitCode !== 0) {
      const message = env.result ?? `claude exited with code ${exitCode}`;
      const auth = /not logged in|\/login|invalid api key/i.test(message);
      return failure(auth ? "auth" : "process", message, !auth, env.duration_ms ?? elapsed(), usage);
    }
    if (env.structured_output === undefined) {
      return {
        ...failure("invalid_json", "The CLI returned no structured_output.", true, env.duration_ms ?? elapsed(), usage),
        output: env.result,
      };
    }
    return {
      ok: true,
      output: env.structured_output,
      error: null,
      errorCode: null,
      retryable: false,
      durationMs: env.duration_ms ?? elapsed(),
      ...usage,
    };
  }
}
