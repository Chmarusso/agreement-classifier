import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpAnonymizer } from "@app/anonymization";
import { detectFormat, detectLanguage, extractText } from "@app/extraction";
import { startAnonymizerService } from "@app/test-utils";
import { anonymizationSamples, sampleFileName } from "../anonymization/samples.ts";

/** The hand-testing samples double as a recall check: everything listed must be replaced, the rest kept. */
let service: Awaited<ReturnType<typeof startAnonymizerService>>;
let anonymizer: HttpAnonymizer;
beforeAll(async () => {
  service = await startAnonymizerService();
  anonymizer = new HttpAnonymizer(service.url, { keep: ["Northwind Analytics"] });
});
afterAll(async () => {
  await service?.stop();
});

describe.each(anonymizationSamples.map((s) => [s.slug, s] as const))("%s", (_slug, s) => {
  let text: string;
  let out: Awaited<ReturnType<HttpAnonymizer["anonymize"]>>;
  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(join(import.meta.dir, "../anonymization/files", sampleFileName(s))));
    text = (await extractText(bytes, detectFormat(bytes, sampleFileName(s)).format)).text;
    out = await anonymizer.anonymize(text);
  });

  test("is detected in its language", () => {
    expect(detectLanguage(text)).toBe(s.language);
  });

  test("replaces every listed value", () => {
    expect(s.mustReplace.filter((v) => out.text.includes(v))).toEqual([]);
  });

  test("keeps the text the audit needs", () => {
    expect(s.mustKeep.filter((v) => !out.text.includes(v))).toEqual([]);
  });
});
