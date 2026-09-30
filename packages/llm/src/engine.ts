import {
  type AgreementMetadata,
  type AgreementType,
  auditOutputJsonSchema,
  buildAuditPrompt,
  computeVerdict,
  isUncertain,
  mergeVotes,
  type PromptRule,
  type PromptSection,
  type StoredFinding,
  toStoredFindings,
  type Verdict,
  type VoteOutcome,
  type VotingMode,
  validateAuditOutput,
} from "@app/domain";
import type { AuditModelClient, AuditModelResult } from "./types.ts";

export const MAX_MODEL_ATTEMPTS = 3;

export interface VotingOptions {
  mode: VotingMode;
  /** Extra answers requested for each voted rule. */
  samples: number;
  /** Sampling temperature for the extra answers, so they can differ from the first. */
  temperature?: number;
}

export interface EngineInput {
  client: AuditModelClient;
  agreement: { title: string; type: AgreementType; sections: PromptSection[]; fileName: string };
  rules: PromptRule[];
  timeoutMs?: number;
  maxAttempts?: number;
  voting?: VotingOptions;
  hooks?: {
    /** Called before each model call; return false to stop (for example when the run was cancelled). */
    beforeCall?: (a: {
      attemptNo: number;
      systemPrompt: string;
      prompt: string;
      promptSha256: string;
      purpose: "audit" | "vote";
    }) => Promise<boolean | undefined>;
    afterCall?: (a: { attemptNo: number; result: AuditModelResult }) => Promise<void>;
    onRejected?: (a: { attemptNo: number; errors: string[] }) => Promise<void>;
    onVoted?: (a: { mode: "uncertain" | "all"; samples: number; outcomes: VoteOutcome[] }) => Promise<void>;
  };
}

export type EngineResult =
  | {
      ok: true;
      verdict: Verdict;
      summary: string;
      findings: StoredFinding[];
      agreementMetadata: AgreementMetadata;
      attempts: number;
      costUsd: number;
      durationMs: number;
      votes: VoteOutcome[];
    }
  | { ok: false; reason: string; retryable: boolean; attempts: number; costUsd: number; durationMs: number; stopped?: boolean };

class Stopped extends Error {}

/**
 * Prompt → model → validate, retrying with the validation errors appended until
 * the answer is valid or attempts run out. Then, if voting is on, asks for extra
 * answers on the selected rules in parallel and keeps the majority status.
 */
export async function runAuditEngine(input: EngineInput): Promise<EngineResult> {
  const maxAttempts = input.maxAttempts ?? MAX_MODEL_ATTEMPTS;
  const jsonSchema = auditOutputJsonSchema();
  const sectionIds = input.agreement.sections.map((s) => s.id);
  let attemptNo = 0;
  let costUsd = 0;
  let durationMs = 0;
  // Hook calls are serialised so event appends to one stream never race.
  let hookChain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = hookChain.then(fn);
    hookChain = next.catch(() => {});
    return next;
  };

  const prepare = async (rules: PromptRule[], purpose: "audit" | "vote", previousErrors?: string[]) => {
    const built = buildAuditPrompt({ agreement: input.agreement, rules, previousErrors });
    const no = ++attemptNo;
    const proceed = await serial(async () => input.hooks?.beforeCall?.({ attemptNo: no, ...built, purpose }));
    if (proceed === false) throw new Stopped();
    return { no, ...built };
  };
  const call = async (p: { no: number; systemPrompt: string; prompt: string }, rules: PromptRule[], temperature?: number) => {
    const result = await input.client.audit({
      systemPrompt: p.systemPrompt,
      prompt: p.prompt,
      jsonSchema,
      timeoutMs: input.timeoutMs ?? 180_000,
      temperature,
      context: {
        agreementTitle: input.agreement.title,
        agreementFileName: input.agreement.fileName,
        rules,
        sections: input.agreement.sections,
      },
    });
    costUsd += result.costUsd;
    durationMs += result.durationMs;
    await serial(async () => input.hooks?.afterCall?.({ attemptNo: p.no, result }));
    return result;
  };

  try {
    // 1. The audit itself, with retries.
    let previousErrors: string[] | undefined;
    let lastReason = "No attempt was made.";
    let primary: { findings: StoredFinding[]; summary: string; agreementMetadata: AgreementMetadata } | null = null;
    for (let i = 1; i <= maxAttempts && !primary; i++) {
      const p = await prepare(input.rules, "audit", previousErrors);
      const result = await call(p, input.rules);
      if (!result.ok) {
        lastReason = result.error ?? "The model call failed.";
        if (result.errorCode === "invalid_json") {
          previousErrors = ["The answer was not valid JSON. Return only the JSON object."];
          await serial(async () => input.hooks?.onRejected?.({ attemptNo: p.no, errors: previousErrors! }));
          continue;
        }
        if (!result.retryable) return { ok: false, reason: lastReason, retryable: false, attempts: attemptNo, costUsd, durationMs };
        continue;
      }
      const v = validateAuditOutput(
        result.output,
        input.rules.map((r) => r.id),
        sectionIds,
      );
      if (!v.ok) {
        lastReason = `The model answer failed validation: ${v.errors.join("; ")}`;
        previousErrors = v.errors;
        await serial(async () => input.hooks?.onRejected?.({ attemptNo: p.no, errors: v.errors }));
        continue;
      }
      primary = {
        findings: toStoredFindings(v.output, input.rules, input.agreement.sections),
        summary: v.output.summary,
        agreementMetadata: v.output.agreementMetadata,
      };
    }
    if (!primary)
      return {
        ok: false,
        reason: `${lastReason} (after ${maxAttempts} attempts)`,
        retryable: true,
        attempts: attemptNo,
        costUsd,
        durationMs,
      };

    // 2. Majority voting on the selected rules. Invalid or failed samples are simply not counted.
    let findings = primary.findings;
    let outcomes: VoteOutcome[] = [];
    const voting = input.voting;
    if (voting && voting.mode !== "off" && voting.samples > 0) {
      const voted = voting.mode === "all" ? findings : findings.filter(isUncertain);
      if (voted.length) {
        const rules = input.rules.filter((r) => voted.some((f) => f.ruleId === r.id));
        const prepared = [];
        for (let s = 0; s < voting.samples; s++) prepared.push(await prepare(rules, "vote"));
        const samples = await Promise.all(
          prepared.map(async (p) => {
            const result = await call(p, rules, voting.temperature ?? 0.7);
            if (!result.ok) return null;
            const v = validateAuditOutput(
              result.output,
              rules.map((r) => r.id),
              sectionIds,
            );
            if (!v.ok) {
              await serial(async () => input.hooks?.onRejected?.({ attemptNo: p.no, errors: v.errors }));
              return null;
            }
            return toStoredFindings(v.output, rules, input.agreement.sections);
          }),
        );
        const merged = mergeVotes(
          findings,
          samples.filter((s): s is StoredFinding[] => !!s),
          rules.map((r) => r.id),
        );
        findings = merged.findings;
        outcomes = merged.outcomes;
        await serial(async () => input.hooks?.onVoted?.({ mode: voting.mode as "uncertain" | "all", samples: voting.samples, outcomes }));
      }
    }

    return {
      ok: true,
      verdict: computeVerdict(findings),
      summary: primary.summary,
      findings,
      agreementMetadata: primary.agreementMetadata,
      attempts: attemptNo,
      costUsd,
      durationMs,
      votes: outcomes,
    };
  } catch (err) {
    if (err instanceof Stopped)
      return {
        ok: false,
        reason: "Stopped before the model call.",
        retryable: false,
        attempts: attemptNo - 1,
        costUsd,
        durationMs,
        stopped: true,
      };
    throw err;
  }
}

export function votingFromEnv(env: Record<string, string | undefined>): VotingOptions {
  const mode = (env.AUDIT_VOTING ?? "uncertain") as VotingMode;
  if (!["off", "uncertain", "all"].includes(mode)) throw new Error(`AUDIT_VOTING must be off, uncertain or all, not ${mode}`);
  return { mode, samples: Number(env.AUDIT_VOTE_SAMPLES ?? 2), temperature: Number(env.AUDIT_VOTE_TEMPERATURE ?? 0.3) };
}
