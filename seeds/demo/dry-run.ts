import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anonymizerFromEnv } from "@app/anonymization";
import { detectLanguage, extractText, segmentSections } from "@app/extraction";
import { createAuditClient, environmentAuditModel, runAuditEngine, votingFromEnv } from "@app/llm";
import { fixtureResponder } from "../fixtures/stub.ts";
import { seedRules } from "../rules.ts";
import { demoRule } from "./rule.ts";

// Audits the demo agreement with the configured model, without touching the database: bun run seeds/demo/dry-run.ts
const bytes = new Uint8Array(readFileSync(join(import.meta.dir, "saas-pl-ai-training.pdf")));
const { text } = await extractText(bytes, "pdf");
const language = detectLanguage(text);
const anonymizer = anonymizerFromEnv(process.env);
const anon = anonymizer ? await anonymizer.anonymize(text, { language }) : null;
console.info(`language ${language}; anonymized: ${anon?.entities.map((e) => `${e.placeholder}=${e.value}`).join(", ") ?? "off"}`);

const rules = [...seedRules.filter((r) => r.appliesTo.length === 0 || r.appliesTo.includes("SaaS")), demoRule].map((r, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  version: 1,
  slug: r.slug,
  title: r.title,
  description: r.description,
  severity: r.severity,
  category: r.category,
}));
const client = createAuditClient(environmentAuditModel(process.env), process.env, fixtureResponder);
console.info(`model ${client.label}, ${rules.length} rules`);
const result = await runAuditEngine({
  client,
  agreement: {
    title: "Umowa SaaS – Chmura Nexus",
    type: "SaaS",
    sections: segmentSections(anon?.text ?? text),
    fileName: "saas-pl-ai-training.pdf",
  },
  rules,
  timeoutMs: 180_000,
  voting: votingFromEnv(process.env),
});
if (!result.ok) throw new Error(result.reason);
console.info(`verdict ${result.verdict}, $${result.costUsd.toFixed(4)}, ${Math.round(result.durationMs / 1000)} s`);
for (const f of result.findings) {
  const slug = rules.find((r) => r.id === f.ruleId)?.slug;
  console.info(`${f.status.padEnd(14)} ${slug}`);
}
for (const f of result.findings.filter((f) => f.status !== "pass" || f.ruleTitle === demoRule.title))
  console.info(
    JSON.stringify(
      {
        rule: f.ruleTitle,
        status: f.status,
        votes: f.votes,
        explanation: f.explanation,
        evidence: f.evidence.map((e) => `${e.location}: ${e.quote.slice(0, 120)}`),
      },
      null,
      2,
    ),
  );
