import { type AuditModelConfig, type LlmProvider, llmProviders, type OpenRouterReasoning } from "@app/domain";
import { DEFAULT_OPENROUTER_MODEL } from "./openrouter.ts";

const DEFAULT_CLAUDE_MODEL = "opus";

/** A fully decided audit model: provider, concrete model id, reasoning mode and the label recorded on runs. */
export interface ResolvedAuditModel {
  provider: LlmProvider;
  model: string;
  reasoning: OpenRouterReasoning;
  label: string;
  /** Whether an admin setting or the process environment decided it. */
  source: "admin" | "environment";
}

export type Env = Record<string, string | undefined>;

/** LLM_PROVIDER wins when set; an empty value (as docker compose passes it) falls back like an unset one. */
function providerFromEnv(env: Env): LlmProvider {
  const provider = env.LLM_PROVIDER?.trim() || (env.OPENROUTER_API_KEY ? "openrouter" : "stub");
  if (!(llmProviders as readonly string[]).includes(provider)) {
    throw new Error(`LLM_PROVIDER must be one of ${llmProviders.join(", ")}, not "${provider}"`);
  }
  return provider as LlmProvider;
}

/** The environment's own choice, used when no admin setting is stored. */
export function environmentAuditModel(env: Env): ResolvedAuditModel {
  return resolveConfig(
    {
      provider: providerFromEnv(env),
      model: null,
      reasoning: (env.OPENROUTER_REASONING as OpenRouterReasoning | undefined) || null,
    },
    env,
    "environment",
  );
}

/** Applies an admin setting on top of the environment defaults. */
export function resolveAuditModel(env: Env, stored: AuditModelConfig | null): ResolvedAuditModel {
  return stored ? resolveConfig(stored, env, "admin") : environmentAuditModel(env);
}

function resolveConfig(config: AuditModelConfig, env: Env, source: ResolvedAuditModel["source"]): ResolvedAuditModel {
  const reasoning = config.reasoning ?? "off";
  switch (config.provider) {
    case "openrouter": {
      const model = config.model ?? env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
      return { provider: "openrouter", model, reasoning, label: `openrouter/${model}`, source };
    }
    case "claude-cli":
    case "claude-bridge": {
      const model = config.model ?? env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;
      return { provider: config.provider, model, reasoning, label: `${config.provider}/${model}`, source };
    }
    case "stub":
      return { provider: "stub", model: "stub", reasoning, label: "stub", source };
  }
}

export interface ProviderAvailability {
  id: LlmProvider;
  available: boolean;
  /** Why the provider cannot be chosen, when it cannot. */
  reason: string | null;
}

/** Which providers the current environment can actually run. */
export function providerAvailability(env: Env): ProviderAvailability[] {
  return llmProviders.map((id) => {
    switch (id) {
      case "openrouter":
        return { id, available: !!env.OPENROUTER_API_KEY, reason: env.OPENROUTER_API_KEY ? null : "OPENROUTER_API_KEY is not set" };
      case "claude-bridge": {
        const ok = !!env.CLAUDE_BRIDGE_URL && !!env.CLAUDE_BRIDGE_TOKEN;
        return { id, available: ok, reason: ok ? null : "CLAUDE_BRIDGE_URL and CLAUDE_BRIDGE_TOKEN are not set" };
      }
      default:
        return { id, available: true, reason: null };
    }
  });
}
