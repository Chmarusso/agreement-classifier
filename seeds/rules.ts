import type { AgreementLanguage, AgreementType, Severity } from "@app/domain";
import { ruleIdForSlug } from "@app/domain";

export interface SeedRule {
  slug: string;
  title: string;
  description: string;
  severity: Severity;
  category: string;
  appliesTo: AgreementType[];
  /** Limit to Polish or English agreements; all languages when absent. */
  languages?: AgreementLanguage[];
}

/** The company's agreement policy. Ids are derived from slugs so seeds, stubs and evals agree. */
export const seedRules: SeedRule[] = [
  {
    slug: "governing-law",
    title: "Polish governing law",
    description: "The agreement must state expressly that it is governed by the laws of Poland. A missing governing-law clause fails.",
    severity: "critical",
    category: "Legal",
    appliesTo: [],
  },
  {
    slug: "liability-cap",
    title: "Liability is capped",
    description:
      "Each party's total liability must be capped at no more than the fees paid or payable in the 12 months before the claim. For agreements without fees, a fixed cap of at most PLN 500,000 is required. Uncapped liability, except for wilful misconduct or gross negligence, fails. A missing liability clause fails.",
    severity: "critical",
    category: "Risk",
    appliesTo: ["NDA", "MSA", "SaaS"],
  },
  {
    slug: "termination-notice",
    title: "Termination for convenience with 30 days' notice",
    description:
      "Either party must be able to terminate for convenience at any time during the term by written notice of at least 30 days. A clause that removes or suspends the Company's termination-for-convenience right for a period, such as a minimum commitment period, fails even if the right is granted elsewhere. No termination-for-convenience right, or a notice period shorter than 30 days, fails. Automatic renewal is covered by a separate rule and does not affect this one.",
    severity: "high",
    category: "Term",
    appliesTo: ["NDA", "MSA", "SaaS"],
  },
  {
    slug: "payment-terms",
    title: "Payment within 60 days",
    description: "Invoices must be payable within at most 60 days of receipt. A longer payment term fails.",
    severity: "medium",
    category: "Commercial",
    appliesTo: ["MSA", "SaaS"],
  },
  {
    slug: "confidentiality-term",
    title: "Confidentiality survives 3 years",
    description:
      "Confidentiality obligations must continue for at least 3 years after the agreement ends. A shorter survival period is partial. No confidentiality obligation after the end of the agreement fails.",
    severity: "high",
    category: "Confidentiality",
    appliesTo: ["NDA", "MSA", "Employment"],
  },
  {
    slug: "ip-assignment",
    title: "IP created for the Company is assigned to it",
    description:
      "Intellectual property created by the counterparty or employee in performing the agreement must be assigned to the Company, or licensed to it exclusively and without time limit.",
    severity: "high",
    category: "Intellectual property",
    appliesTo: ["MSA", "Employment"],
  },
  {
    slug: "non-compete-limit",
    title: "Post-employment non-compete at most 6 months",
    description:
      "A post-employment non-compete may last at most 6 months and must pay compensation of at least 25% of the employee's salary for its duration. Having no post-employment non-compete passes.",
    severity: "high",
    category: "Employment",
    appliesTo: ["Employment"],
  },
  {
    slug: "gdpr-data-processing",
    title: "GDPR data-processing terms",
    description:
      "If the counterparty processes personal data for the Company, the agreement must contain data-processing terms under Article 28 GDPR or refer to a signed data processing agreement. Employment agreements must contain an information clause on processing the employee's personal data.",
    severity: "critical",
    category: "Data protection",
    appliesTo: ["MSA", "SaaS", "Employment"],
  },
  {
    slug: "no-auto-renewal",
    title: "No automatic renewal without an opt-out",
    description:
      "The agreement must not renew automatically, unless the Company can prevent renewal by written notice given at least 30 days before the renewal date.",
    severity: "high",
    category: "Term",
    appliesTo: ["MSA", "SaaS"],
  },
  {
    slug: "dispute-resolution",
    title: "Disputes resolved in Poland",
    description: "Disputes must be resolved by the common courts in Warsaw or by arbitration seated in Poland.",
    severity: "medium",
    category: "Legal",
    appliesTo: [],
  },
  {
    slug: "signature-authority",
    title: "Signatories and titles named",
    description: "The signature block must name the person signing for each party and state that person's title or role.",
    severity: "low",
    category: "Formalities",
    appliesTo: [],
  },
  {
    slug: "insurance",
    title: "Professional liability insurance of EUR 1M",
    description:
      "The supplier must maintain professional liability insurance covering at least EUR 1,000,000 for the term of the agreement.",
    severity: "medium",
    category: "Risk",
    appliesTo: ["MSA"],
  },
];

export const seedRuleId = (slug: string) => ruleIdForSlug(slug);
