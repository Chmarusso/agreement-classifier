import { BridgeAuditClient } from "./bridge.ts";
import { ClaudeCliAuditClient } from "./claude-cli.ts";
import { OpenRouterAuditClient } from "./openrouter.ts";
import { environmentAuditModel, type ResolvedAuditModel } from "./resolve.ts";
import { allPassResponder, StubAuditClient, type StubResponder } from "./stub.ts";
import type { AuditModelClient } from "./types.ts";

export type { LlmProvider } from "@app/domain";
export * from "./bridge.ts";
export * from "./claude-cli.ts";
export * from "./openrouter.ts";
export * from "./stub.ts";
export * from "./types.ts";

/** Builds the client for a resolved model. Credentials always come from the environment. */
export function createAuditClient(
  resolved: ResolvedAuditModel,
  env: Record<string, string | undefined>,
  stubResponder: StubResponder = allPassResponder,
): AuditModelClient {
  switch (resolved.provider) {
    case "openrouter":
      if (!env.OPENROUTER_API_KEY) throw new Error("The openrouter provider needs OPENROUTER_API_KEY");
      return new OpenRouterAuditClient({ apiKey: env.OPENROUTER_API_KEY, model: resolved.model, reasoning: resolved.reasoning });
    case "claude-cli":
      return new ClaudeCliAuditClient({ model: resolved.model });
    case "claude-bridge":
      if (!env.CLAUDE_BRIDGE_URL || !env.CLAUDE_BRIDGE_TOKEN)
        throw new Error("The claude-bridge provider needs CLAUDE_BRIDGE_URL and CLAUDE_BRIDGE_TOKEN");
      return new BridgeAuditClient({ url: env.CLAUDE_BRIDGE_URL, token: env.CLAUDE_BRIDGE_TOKEN, label: resolved.label });
    case "stub":
      return new StubAuditClient(stubResponder);
  }
}

/**
 * Picks the audit model from the environment alone. OpenRouter with a cheap
 * model is the default placeholder; Claude runs only when LLM_PROVIDER names it.
 */
export function createAuditClientFromEnv(
  env: Record<string, string | undefined>,
  stubResponder: StubResponder = allPassResponder,
): AuditModelClient {
  return createAuditClient(environmentAuditModel(env), env, stubResponder);
}
export * from "./engine.ts";
export * from "./resolve.ts";
