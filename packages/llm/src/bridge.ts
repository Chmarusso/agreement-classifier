import { type AuditModelClient, type AuditModelRequest, type AuditModelResult, failure } from "./types.ts";

export interface BridgeOptions {
  /** `unix:///path/to.sock` or `http://host.docker.internal:8787`. */
  url: string;
  token: string;
  label?: string;
}

/** Calls the host-side claude bridge (apps/claude-bridge) from inside a container. */
export class BridgeAuditClient implements AuditModelClient {
  readonly label: string;
  constructor(private readonly opts: BridgeOptions) {
    this.label = opts.label ?? "claude-bridge";
  }

  async audit(req: AuditModelRequest): Promise<AuditModelResult> {
    const started = performance.now();
    const isUnix = this.opts.url.startsWith("unix://");
    const target = isUnix ? "http://bridge/v1/audit" : `${this.opts.url.replace(/\/$/, "")}/v1/audit`;
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bridge-token": this.opts.token },
        body: JSON.stringify({ ...req, context: undefined }),
        signal: AbortSignal.timeout(req.timeoutMs + 10_000),
        ...(isUnix ? { unix: this.opts.url.slice("unix://".length) } : {}),
      } as RequestInit);
      if (res.status === 401) return failure("auth", "The bridge rejected the token.", false, Math.round(performance.now() - started));
      return (await res.json()) as AuditModelResult;
    } catch (err) {
      return failure(
        "http",
        `Claude bridge unreachable at ${this.opts.url}: ${String(err)}`,
        true,
        Math.round(performance.now() - started),
      );
    }
  }
}
