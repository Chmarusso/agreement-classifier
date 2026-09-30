import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { startBridge } from "./server.ts";

const token = process.env.CLAUDE_BRIDGE_TOKEN;
if (!token || token.length < 16) {
  console.error("Set CLAUDE_BRIDGE_TOKEN (at least 16 characters); the worker sends the same value.");
  process.exit(1);
}
const socketPath = resolve(process.env.CLAUDE_BRIDGE_SOCKET ?? ".run/claude-bridge.sock");
mkdirSync(dirname(socketPath), { recursive: true });
const bridge = startBridge({
  token,
  socketPath,
  port: Number(process.env.CLAUDE_BRIDGE_PORT ?? 8787),
  model: process.env.CLAUDE_MODEL ?? "opus",
});
console.info(`[bridge] ${bridge.label} on unix://${socketPath} and tcp :${bridge.port}`);
