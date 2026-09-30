import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AgreementDetailDto, AgreementDto, AuditRunDetailDto, RuleDto } from "@app/contracts";
import { environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fixtureResponder } from "@app/seeds/stub";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness } from "./harness.ts";

/** Rules limited to Polish or English agreements are picked by the language detected at extraction. */
let h: Awaited<ReturnType<typeof createHarness>>;
let admin: string;
let worker: Worker;
let plRule: RuleDto;
let enRule: RuleDto;

beforeAll(async () => {
  h = await createHarness();
  await seedAllRules(h.t);
  admin = await h.login("admin@example.com");
  worker = new Worker({
    database: h.t,
    workerId: "language-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({})),
      run_audit: runAuditHandler(async () => new StubAuditClient(fixtureResponder)),
    },
  });
  const create = async (body: object) => {
    const res = await h.call("POST", "/rules", { cookie: admin, body });
    expect(res.status).toBe(201);
    return (await res.json()) as RuleDto;
  };
  plRule = await create({
    title: "Polish agreements are signed in written form",
    description: "A Polish agreement must say it is concluded in written form (forma pisemna) under pain of nullity for amendments.",
    severity: "low",
    category: "Form",
    appliesTo: ["NDA"],
    languages: ["pl"],
  });
  enRule = await create({
    title: "English agreements name the prevailing language",
    description: "An English agreement must state that the English version prevails over any translation.",
    severity: "low",
    category: "Form",
    appliesTo: [],
    languages: ["en"],
  });
});
afterAll(async () => {
  await h.close();
});

const get = async <T>(path: string) => (await (await h.call("GET", path, { cookie: admin })).json()) as T;

async function auditedRuleIds(fileName: string): Promise<{ detail: AgreementDetailDto; ruleIds: string[] }> {
  const res = await h.upload(fileName, "NDA", admin);
  const a = (await res.json()) as AgreementDto;
  await worker.drain();
  const detail = await get<AgreementDetailDto>(`/agreements/${a.id}`);
  const run = await get<AuditRunDetailDto>(`/audits/${detail.runs[0]!.id}`);
  return { detail, ruleIds: run.findings.map((f) => f.ruleId) };
}

test("rules keep their languages", async () => {
  expect(plRule.languages).toEqual(["pl"]);
  const rules = await get<RuleDto[]>("/rules");
  expect(rules.find((r) => r.id === enRule.id)?.languages).toEqual(["en"]);
  expect(rules.filter((r) => r.languages.length === 0).length).toBeGreaterThan(0);
});

test("a Polish NDA is audited with the Polish-only rule and without the English-only one", async () => {
  const { detail, ruleIds } = await auditedRuleIds("nda-pl-compliant.md");
  expect(detail.language).toBe("pl");
  expect(ruleIds).toContain(plRule.id);
  expect(ruleIds).not.toContain(enRule.id);
  expect(detail.applicableRuleCount).toBe(ruleIds.length);
});

test("an English NDA is audited with the English-only rule and without the Polish-only one", async () => {
  const { detail, ruleIds } = await auditedRuleIds("nda-missing-signature-titles.md");
  expect(detail.language).toBe("en");
  expect(ruleIds).toContain(enRule.id);
  expect(ruleIds).not.toContain(plRule.id);
});

test("changing only the languages creates a new rule version", async () => {
  const res = await h.call("PATCH", `/rules/${plRule.id}`, {
    cookie: admin,
    body: { ...plRule, languages: ["pl", "en"], version: plRule.version },
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as RuleDto).contentVersion).toBe(2);
});
