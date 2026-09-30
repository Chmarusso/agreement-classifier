import { timingSafeEqual } from "node:crypto";
import { unlinkSync } from "node:fs";
import { type AuditModelRequest, ClaudeCliAuditClient } from "@app/llm";

export interface BridgeConfig {
  token: string;
  socketPath: string | null;
  port: number | null;
  model: string;
  binary?: string;
  maxConcurrent?: number;
}

/**
 * Host-side HTTP service that runs `claude -p` for workers inside Docker,
 * which cannot use the host's CLI login. Listens on a unix socket and/or TCP.
 */
export function startBridge(cfg: BridgeConfig) {
  const client = new ClaudeCliAuditClient({ model: cfg.model, binary: cfg.binary });
  const max = cfg.maxConcurrent ?? 2;
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = async (): Promise<void> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
  };
  const release = () => {
    active--;
    waiting.shift()?.();
  };

  const authorized = (req: Request) => {
    const got = Buffer.from(req.headers.get("x-bridge-token") ?? "");
    const want = Buffer.from(cfg.token);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      const proc = Bun.spawn([cfg.binary ?? "claude", "--version"], { stdout: "pipe", stderr: "pipe" });
      const out = (await new Response(proc.stdout).text()).trim();
      return Response.json({ ok: (await proc.exited) === 0, cli: out, model: cfg.model, active, queued: waiting.length });
    }
    if (url.pathname === "/v1/audit" && req.method === "POST") {
      if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = (await req.json()) as AuditModelRequest;
      await acquire();
      try {
        // Prompt contents are never logged.
        const result = await client.audit({ ...body, context: { agreementTitle: "", agreementFileName: "", rules: [], sections: [] } });
        return Response.json(result);
      } finally {
        release();
      }
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };

  const servers: ReturnType<typeof Bun.serve>[] = [];
  if (cfg.socketPath) {
    try {
      unlinkSync(cfg.socketPath);
    } catch {}
    servers.push(Bun.serve({ unix: cfg.socketPath, fetch }));
  }
  if (cfg.port !== null) servers.push(Bun.serve({ port: cfg.port, hostname: "0.0.0.0", fetch, idleTimeout: 0 }));
  return {
    label: client.label,
    port: servers.find((s) => s.port)?.port ?? null,
    stop: () => {
      for (const s of servers) s.stop(true);
    },
  };
}
