/**
 * Agreement classification evals.
 *
 *   bun run eval                      all fixtures, model from the environment (OpenRouter by default)
 *   bun run eval --only nda-compliant,saas-auto-renewal
 *   bun run eval --failed             rerun only fixtures that failed in the latest run
 *   bun run eval --provider stub      no model calls; checks the harness itself
 *   bun run eval --provider claude-cli --model opus
 *   bun run eval --voting all --samples 2   majority vote over every finding (off, uncertain, all)
 *
 * Each run writes evals/results/<run-id>/ (report.md, results.json) and updates evals/results/latest.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { anonymizerFromEnv, applyPlaceholders, rehydrateDeep } from "@app/anonymization";
import { type FindingStatus, type PromptRule, rulesApplyingTo, type Verdict } from "@app/domain";
import { detectFormat, ExtractionError, extractText, segmentSections } from "@app/extraction";
import { createAuditClientFromEnv, runAuditEngine, votingFromEnv } from "@app/llm";
import { type Fixture, fileNameFor, fixtures } from "@app/seeds/fixtures";
import { seedRuleId, seedRules } from "@app/seeds/rules";
import { fixtureResponder } from "@app/seeds/stub";

const ROOT = import.meta.dir;
const FILES = join(ROOT, "../seeds/agreements/files");
const RESULTS = join(ROOT, "results");

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    failed: { type: "boolean", default: false },
    provider: { type: "string" },
    model: { type: "string" },
    concurrency: { type: "string", default: "4" },
    voting: { type: "string" },
    samples: { type: "string" },
    /** Anonymize each agreement first, as the worker does. Needs ANONYMIZER_URL (bun run dev:anonymizer). */
    anonymize: { type: "boolean", default: false },
  },
});

const env = { ...process.env };
if (args.provider) env.LLM_PROVIDER = args.provider;
if (args.model) {
  if ((env.LLM_PROVIDER ?? "openrouter") === "openrouter") env.OPENROUTER_MODEL = args.model;
  else env.CLAUDE_MODEL = args.model;
}
if (args.voting) env.AUDIT_VOTING = args.voting;
if (args.samples) env.AUDIT_VOTE_SAMPLES = args.samples;
const client = createAuditClientFromEnv(env, fixtureResponder);
const voting = votingFromEnv(env);
const anonymizer = args.anonymize ? anonymizerFromEnv({ ANONYMIZER_URL: "http://localhost:8090", ...env }) : null;
const votingLabel = voting.mode === "off" ? "off" : `${voting.mode}, ${voting.samples} extra answers`;

interface RuleCheck {
  rule: string;
  expected: FindingStatus;
  accepted: FindingStatus[];
  got: FindingStatus | null;
  ok: boolean;
  quoteExpected: string | null;
  quoteFound: boolean | null;
  explanation: string | null;
}

interface FixtureResult {
  slug: string;
  title: string;
  ok: boolean;
  expectedVerdict: Verdict | "extraction_failed";
  gotVerdict: Verdict | "extraction_failed" | "error";
  verdictOk: boolean;
  rules: RuleCheck[];
  rulesCorrect: number;
  evidenceVerified: string;
  /** Quotes whose cited section is exactly where the quote appears. */
  citationsExact: string;
  voted: { rule: string; votes: string[]; final: string; changed: boolean }[];
  attempts: number;
  costUsd: number;
  durationMs: number;
  error: string | null;
}

function selectFixtures(): Fixture[] {
  if (args.only) {
    const wanted = new Set(args.only.split(",").map((s) => s.trim()));
    const unknown = [...wanted].filter((w) => !fixtures.some((f) => f.slug === w));
    if (unknown.length) throw new Error(`Unknown fixture(s): ${unknown.join(", ")}. Known: ${fixtures.map((f) => f.slug).join(", ")}`);
    return fixtures.filter((f) => wanted.has(f.slug));
  }
  if (args.failed) {
    const latest = join(RESULTS, "latest.json");
    if (!existsSync(latest)) throw new Error("No previous run found; run `bun run eval` first.");
    const prev = JSON.parse(readFileSync(latest, "utf8")) as { results: FixtureResult[] };
    const failed = new Set(prev.results.filter((r) => !r.ok).map((r) => r.slug));
    return fixtures.filter((f) => failed.has(f.slug));
  }
  return fixtures;
}

const allRules: (PromptRule & { appliesTo: (typeof seedRules)[number]["appliesTo"] })[] = seedRules.map((r) => ({
  id: seedRuleId(r.slug),
  version: 1,
  slug: r.slug,
  title: r.title,
  description: r.description,
  severity: r.severity,
  category: r.category,
  appliesTo: r.appliesTo,
}));

async function evaluate(f: Fixture): Promise<FixtureResult> {
  const base = {
    slug: f.slug,
    title: f.title,
    attempts: 0,
    costUsd: 0,
    durationMs: 0,
    rules: [] as RuleCheck[],
    rulesCorrect: 0,
    evidenceVerified: "-",
    citationsExact: "-",
    voted: [] as FixtureResult["voted"],
  };
  const bytes = new Uint8Array(readFileSync(join(FILES, fileNameFor(f))));
  let text: string;
  try {
    text = (await extractText(bytes, detectFormat(bytes, fileNameFor(f)).format)).text;
  } catch (err) {
    const failedAsExpected = f.expected.extraction === "failed" && err instanceof ExtractionError && err.reason === f.expected.reason;
    return {
      ...base,
      ok: failedAsExpected,
      expectedVerdict: f.expected.extraction === "failed" ? "extraction_failed" : f.expected.verdict,
      gotVerdict: "extraction_failed",
      verdictOk: failedAsExpected,
      error: failedAsExpected ? null : String(err),
    };
  }
  if (f.expected.extraction === "failed") {
    return {
      ...base,
      ok: false,
      expectedVerdict: "extraction_failed",
      gotVerdict: "error",
      verdictOk: false,
      error: "Extraction unexpectedly succeeded",
    };
  }

  const rules = rulesApplyingTo(allRules, f.type);
  // Scored on the rehydrated answer, so expected quotes still match.
  const anonymized = anonymizer ? await anonymizer.anonymize(text) : null;
  const entities = anonymized?.entities ?? [];
  const engineResult = await runAuditEngine({
    client,
    agreement: {
      title: applyPlaceholders(f.title, entities),
      type: f.type,
      sections: segmentSections(anonymized?.text ?? text),
      fileName: fileNameFor(f),
    },
    rules,
    timeoutMs: 180_000,
    voting,
  });
  const result = rehydrateDeep(engineResult, entities);
  const expected = f.expected;
  if (!result.ok) {
    return {
      ...base,
      ok: false,
      expectedVerdict: expected.verdict,
      gotVerdict: "error",
      verdictOk: false,
      attempts: result.attempts,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      error: result.reason,
    };
  }

  const checks: RuleCheck[] = rules.map((rule) => {
    const exp = expected.findings[rule.slug] ?? { status: "pass" as FindingStatus };
    const finding = result.findings.find((x) => x.ruleId === rule.id);
    const accepted = [exp.status, ...(exp.accept ?? [])];
    const quoteFound = exp.quote
      ? (finding?.evidence.some((e) => e.verified && e.quote.toLowerCase().includes(exp.quote!.toLowerCase())) ?? false)
      : null;
    return {
      rule: rule.slug,
      expected: exp.status,
      accepted,
      got: finding?.status ?? null,
      ok: finding ? accepted.includes(finding.status) : false,
      quoteExpected: exp.quote ?? null,
      quoteFound,
      explanation: finding?.explanation ?? null,
    };
  });
  const verdictOk = [expected.verdict, ...(expected.acceptVerdicts ?? [])].includes(result.verdict);
  const allEvidence = result.findings.flatMap((x) => x.evidence);
  return {
    ...base,
    ok: verdictOk && checks.every((c) => c.ok),
    expectedVerdict: expected.verdict,
    gotVerdict: result.verdict,
    verdictOk,
    rules: checks,
    rulesCorrect: checks.filter((c) => c.ok).length,
    evidenceVerified: allEvidence.length ? `${allEvidence.filter((e) => e.verified).length}/${allEvidence.length}` : "-",
    citationsExact: allEvidence.length
      ? `${allEvidence.filter((e) => e.verified && e.citedSectionId === e.sectionId).length}/${allEvidence.length}`
      : "-",
    voted: result.votes.map((v) => ({
      rule: rules.find((r) => r.id === v.ruleId)?.slug ?? v.ruleId,
      votes: v.votes,
      final: v.final,
      changed: v.changed,
    })),
    attempts: result.attempts,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    error: null,
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
        const r = out[i] as unknown as FixtureResult;
        console.log(
          `${r.ok ? "PASS" : "FAIL"}  ${r.slug.padEnd(32)} expected ${String(r.expectedVerdict).padEnd(17)} got ${String(r.gotVerdict).padEnd(17)} $${r.costUsd.toFixed(5)}`,
        );
      }
    }),
  );
  return out;
}

const usd = (n: number) => `$${n.toFixed(5)}`;

function report(runId: string, results: FixtureResult[]): string {
  const passed = results.filter((r) => r.ok).length;
  const cost = results.reduce((s, r) => s + r.costUsd, 0);
  const lines = [
    `# Eval run ${runId}`,
    "",
    `Model: \`${client.label}\``,
    `Voting: ${votingLabel}`,
    `Anonymization: ${anonymizer ? anonymizer.label : "off"}`,
    `Result: ${passed}/${results.length} fixtures correct`,
    `Total cost: ${usd(cost)}`,
    "",
    "| Fixture | Expected | Got | Rules correct | Quotes found | Section cited exactly | Voted rules | Calls | Cost | Time |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.ok ? "✅" : "❌"} ${r.slug} | ${r.expectedVerdict} | ${r.gotVerdict} | ${r.rules.length ? `${r.rulesCorrect}/${r.rules.length}` : "-"} | ${r.evidenceVerified} | ${r.citationsExact} | ${r.voted.length ? r.voted.map((v) => `${v.rule}: ${v.votes.join("/")}→${v.final}`).join("<br>") : "-"} | ${r.attempts} | ${usd(r.costUsd)} | ${(r.durationMs / 1000).toFixed(1)} s |`,
    ),
  ];
  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    lines.push("", "## Misclassifications", "");
    for (const r of failures) {
      lines.push(`### ${r.slug}`, "");
      if (r.error) lines.push(`Error: ${r.error}`, "");
      if (!r.verdictOk) lines.push(`Verdict: expected **${r.expectedVerdict}**, got **${r.gotVerdict}**.`, "");
      for (const c of r.rules.filter((x) => !x.ok)) {
        lines.push(
          `- \`${c.rule}\`: expected ${c.accepted.join(" or ")}, got **${c.got ?? "missing"}**. Model said: ${c.explanation ?? "-"}`,
        );
      }
      lines.push("", `Rerun just this one: \`bun run eval --only ${r.slug}\``, "");
    }
  }
  return `${lines.join("\n")}\n`;
}

const selected = selectFixtures();
if (selected.length === 0) {
  console.log("Nothing to run: the latest run had no failures.");
  process.exit(0);
}
console.log(
  `Running ${selected.length} fixture(s) with ${client.label}, voting ${votingLabel}, anonymization ${anonymizer ? "on" : "off"}\n`,
);
const started = Date.now();
const results = await pool(selected, Number(args.concurrency), evaluate);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join(RESULTS, runId);
mkdirSync(dir, { recursive: true });
const payload = {
  runId,
  model: client.label,
  voting: votingLabel,
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  results,
};
writeFileSync(join(dir, "results.json"), `${JSON.stringify(payload, null, 2)}\n`);
const md = report(runId, results);
writeFileSync(join(dir, "report.md"), md);

// latest.json keeps the newest result per fixture, so `--only` and `--failed` reruns update it in place.
const latestPath = join(RESULTS, "latest.json");
const previous = existsSync(latestPath) ? (JSON.parse(readFileSync(latestPath, "utf8")) as { results: FixtureResult[] }).results : [];
const merged = fixtures
  .map((f) => results.find((r) => r.slug === f.slug) ?? previous.find((r) => r.slug === f.slug))
  .filter((r): r is FixtureResult => !!r);
writeFileSync(
  latestPath,
  `${JSON.stringify({ updatedAt: new Date().toISOString(), model: client.label, lastRunId: runId, results: merged }, null, 2)}\n`,
);

const passed = results.filter((r) => r.ok).length;
console.log(
  `\n${passed}/${results.length} correct, total cost ${usd(results.reduce((s, r) => s + r.costUsd, 0))}. Report: ${join(dir, "report.md")}`,
);
if (passed < results.length) console.log("Rerun failures with: bun run eval --failed");
process.exit(passed === results.length ? 0 : 1);
