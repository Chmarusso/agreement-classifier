import type { SeedRule } from "../rules.ts";

/** The rule added live in the demo. Not seeded, so the demo can create it in the UI. */
export const demoRule: SeedRule = {
  slug: "no-ai-training",
  title: "No AI training on Company data",
  description:
    "The supplier must not use Company data, documents or content to train, fine-tune or improve artificial intelligence or machine learning models, including in anonymised, aggregated or de-identified form, unless the Company opts in separately in writing. A clause that permits such use fails, wherever it appears in the agreement. An agreement that is silent on the topic is partial, because the Company requires an express prohibition.",
  severity: "critical",
  category: "Data protection",
  appliesTo: ["SaaS", "MSA"],
};
