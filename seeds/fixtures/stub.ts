import { type PromptSection, quoteAppearsIn } from "@app/domain";
import type { StubResponder } from "@app/llm";
import { allPassResponder } from "@app/llm";
import { type Fixture, fixtures } from "./agreements.ts";

/** The id of the section that contains the quote, so the stub cites like a real model would. */
function sectionOf(sections: PromptSection[], quote: string): string {
  return sections.find((s) => quoteAppearsIn(s.text, quote))?.id ?? sections[0]?.id ?? "S0";
}

function findFixture(fileName: string, title: string): Fixture | undefined {
  const base = fileName.toLowerCase().replace(/\.[a-z]+$/, "");
  return fixtures.find((f) => base === f.slug || base.startsWith(`${f.slug}`) || f.title === title);
}

/**
 * Deterministic answers for the fixture agreements, derived from their expected
 * results. Rules the fixture does not mention (for example rules added in the
 * UI) are answered with `pass`.
 */
export const fixtureResponder: StubResponder = (req, callNo) => {
  const fixture = findFixture(req.context.agreementFileName, req.context.agreementTitle);
  if (fixture?.expected.extraction !== "extracted") return allPassResponder(req, callNo);
  const expected = fixture.expected.findings;
  return {
    schemaVersion: 1,
    summary: `Stub audit of ${fixture.title}: ${fixture.description}`,
    agreementMetadata: {
      title: fixture.title,
      parties: ["Northwind Analytics sp. z o.o."],
      effectiveDate: null,
      governingLaw: fixture.slug.includes("governing-law") ? null : "Poland",
    },
    findings: req.context.rules.map((rule) => {
      const e = expected[rule.slug] ?? { status: "pass" as const };
      return {
        ruleId: rule.id,
        status: e.status,
        confidence: e.status === "unclear" ? 0.4 : 0.9,
        explanation: e.status === "pass" ? `The agreement satisfies "${rule.title}".` : `The agreement does not satisfy "${rule.title}".`,
        evidence: e.quote ? [{ sectionId: sectionOf(req.context.sections, e.quote), quote: e.quote }] : [],
        recommendation: e.status === "pass" ? null : `Negotiate a clause that meets: ${rule.description}`,
      };
    }),
  };
};
