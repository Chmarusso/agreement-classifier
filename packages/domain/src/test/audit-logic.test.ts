import { describe, expect, test } from "bun:test";
import {
  type AgreementType,
  type AuditOutput,
  buildAuditPrompt,
  isUncertain,
  mergeVotes,
  type PromptRule,
  type PromptSection,
  rulesApplyingTo,
  type StoredFinding,
  toStoredFindings,
  validateAuditOutput,
} from "../index.ts";

const sections: PromptSection[] = [
  { id: "S0", number: null, heading: "Preamble", text: "Agreement between A and B." },
  { id: "S1", number: "1", heading: "Term", text: "1. Term\nThe agreement renews automatically every year." },
  { id: "S2", number: "2", heading: "Governing law", text: "2. Governing law\nThis Agreement is governed by the laws of Poland." },
];
const rule: PromptRule = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  slug: "law",
  title: "Polish law",
  description: "d",
  severity: "critical",
  category: "Legal",
};
const output = (evidence: { sectionId: string; quote: string }[], status: StoredFinding["status"] = "pass"): AuditOutput => ({
  schemaVersion: 1,
  summary: "s",
  agreementMetadata: { title: null, parties: [], effectiveDate: null, governingLaw: null },
  findings: [{ ruleId: rule.id, status, confidence: 0.9, explanation: "e", evidence, recommendation: null }],
});

describe("sectioned prompt and citations", () => {
  test("prompt labels every section with its id", () => {
    const { prompt } = buildAuditPrompt({ agreement: { title: "T", type: "NDA", sections }, rules: [rule] });
    expect(prompt).toContain("[S1] 1. Term");
    expect(prompt).toContain("[S2] 2. Governing law");
  });

  test("an unknown section id is a validation error naming valid ids", () => {
    const r = validateAuditOutput(output([{ sectionId: "S9", quote: "x" }]), [rule.id], ["S0", "S1", "S2"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toContain("unknown sectionId S9");
  });

  test("a correct citation is verified and labelled like a clause reference", () => {
    const [f] = toStoredFindings(output([{ sectionId: "S2", quote: "governed by the laws of Poland" }]), [rule], sections);
    expect(f!.evidence[0]).toMatchObject({ verified: true, sectionId: "S2", citedSectionId: "S2", location: "§2 Governing law" });
  });

  test("a quote cited to the wrong section is verified and re-pointed to where it appears", () => {
    const [f] = toStoredFindings(output([{ sectionId: "S1", quote: "governed by the laws of Poland" }]), [rule], sections);
    expect(f!.evidence[0]).toMatchObject({ verified: true, sectionId: "S2", citedSectionId: "S1" });
  });

  test("an invented quote stays unverified at the cited section", () => {
    const [f] = toStoredFindings(output([{ sectionId: "S2", quote: "governed by the laws of England" }]), [rule], sections);
    expect(f!.evidence[0]).toMatchObject({ verified: false, sectionId: "S2" });
  });
});

describe("majority voting", () => {
  const finding = (status: StoredFinding["status"], confidence = 1, explanation: string = status): StoredFinding => ({
    ruleId: rule.id,
    ruleVersion: 1,
    ruleTitle: "Polish law",
    severity: "critical",
    status,
    confidence,
    explanation,
    evidence: [{ quote: `${status} quote`, location: null, verified: true }],
    recommendation: null,
  });

  test("uncertain means unclear, partial or low confidence", () => {
    expect(isUncertain(finding("unclear"))).toBe(true);
    expect(isUncertain(finding("partial"))).toBe(true);
    expect(isUncertain(finding("fail", 0.6))).toBe(true);
    expect(isUncertain(finding("fail", 0.95))).toBe(false);
  });

  test("the majority overturns the first answer", () => {
    const { findings, outcomes } = mergeVotes([finding("pass")], [[finding("unclear", 0.7)], [finding("unclear", 0.9, "best")]], [rule.id]);
    expect(findings[0]).toMatchObject({ status: "unclear", explanation: "best", votes: ["pass", "unclear", "unclear"] });
    expect(findings[0]!.confidence).toBeCloseTo(0.67, 2);
    expect(outcomes).toEqual([{ ruleId: rule.id, votes: ["pass", "unclear", "unclear"], final: "unclear", changed: true }]);
  });

  test("agreement keeps the answer and marks it unchanged", () => {
    const { outcomes } = mergeVotes([finding("fail")], [[finding("fail")], [finding("fail")]], [rule.id]);
    expect(outcomes[0]).toMatchObject({ final: "fail", changed: false });
  });

  test("a three-way split becomes unclear with everyone's evidence", () => {
    const { findings } = mergeVotes([finding("pass")], [[finding("fail")], [finding("partial")]], [rule.id]);
    expect(findings[0]!.status).toBe("unclear");
    expect(findings[0]!.explanation).toContain("disagreed (pass, fail, partial)");
    expect(findings[0]!.evidence.map((e) => e.quote)).toEqual(["pass quote", "fail quote", "partial quote"]);
  });

  test("a one-to-one tie after a lost sample keeps the first answer", () => {
    const { findings, outcomes } = mergeVotes([finding("fail")], [[finding("pass")]], [rule.id]);
    expect(findings[0]!.status).toBe("fail");
    expect(outcomes[0]).toMatchObject({ votes: ["fail", "pass"], final: "fail", changed: false });
  });

  test("rules not voted on are untouched, and missing samples are ignored", () => {
    const other = { ...finding("pass"), ruleId: "22222222-2222-4222-8222-222222222222" };
    const { findings } = mergeVotes([finding("fail"), other], [[finding("fail")]], [rule.id]);
    expect(findings[1]).toBe(other);
    expect(findings[0]!.votes).toEqual(["fail", "fail"]);
  });
});

describe("rulesApplyingTo with languages", () => {
  const rule = (appliesTo: AgreementType[], languages: ("pl" | "en")[]) => ({ appliesTo, languages });
  const both = rule([], []);
  const plOnly = rule(["NDA"], ["pl"]);
  const enOnly = rule([], ["en"]);

  test("a Polish NDA gets rules for every language and for Polish", () => {
    expect(rulesApplyingTo([both, plOnly, enOnly], "NDA", "pl")).toEqual([both, plOnly]);
  });

  test("an English NDA skips Polish-only rules", () => {
    expect(rulesApplyingTo([both, plOnly, enOnly], "NDA", "en")).toEqual([both, enOnly]);
  });

  test("an unknown language gets every rule", () => {
    expect(rulesApplyingTo([both, plOnly, enOnly], "NDA")).toEqual([both, plOnly, enOnly]);
  });

  test("rules stored before languages existed apply everywhere", () => {
    expect(rulesApplyingTo([{ appliesTo: [] as AgreementType[] }], "MSA", "pl")).toHaveLength(1);
  });
});
