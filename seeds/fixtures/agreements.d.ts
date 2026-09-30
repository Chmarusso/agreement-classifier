import type { AgreementFormat, AgreementType, FindingStatus, Verdict } from "@app/domain";
/**
 * Fixture agreements with known outcomes (PLAN.md section 15.1).
 * Each agreement is assembled from standard clauses; a fixture replaces only
 * the clauses it exists to test, so the expected result is easy to check by reading.
 */
export interface ExpectedFinding {
  status: FindingStatus;
  /** Other statuses that are still counted as correct (model judgement cases). */
  accept?: FindingStatus[];
  /** A fragment the evidence should quote. Used by the stub and reported by evals. */
  quote?: string;
}
export interface Fixture {
  slug: string;
  title: string;
  type: AgreementType;
  /** pdf-long: real-length layout with contents page, running headers and page footers. */
  format: AgreementFormat | "pdf-scan" | "pdf-long";
  description: string;
  /** Written in Polish; English when absent. */
  language?: "pl" | "en";
  /** Personal data (and inflected forms) the anonymizer must replace. Checked by the anonymization tests. */
  pii?: string[];
  expected:
    | {
        extraction: "failed";
        reason: "no_text_layer";
      }
    | {
        extraction: "extracted";
        verdict: Verdict;
        acceptVerdicts?: Verdict[];
        findings: Record<string, ExpectedFinding>;
      };
  markdown: string;
}
export declare const fixtures: Fixture[];
export declare const fileNameFor: (f: Fixture) => string;
