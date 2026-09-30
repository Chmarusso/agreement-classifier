import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpAnonymizer, leakedValues, PLACEHOLDER, rehydrate } from "@app/anonymization";
import { detectFormat, extractText, segmentSections } from "@app/extraction";
import { startAnonymizerService } from "@app/test-utils";
import { fileNameFor, fixtures } from "../fixtures/agreements.ts";

/** Runs the real Python service over the fixture agreements, the way the worker calls it. */
let service: Awaited<ReturnType<typeof startAnonymizerService>>;
let anonymizer: HttpAnonymizer;
beforeAll(async () => {
  service = await startAnonymizerService();
  anonymizer = new HttpAnonymizer(service.url, { keep: ["Northwind Analytics"] });
});
afterAll(async () => {
  await service?.stop();
});

const textOf = async (slug: string) => {
  const f = fixtures.find((x) => x.slug === slug)!;
  const bytes = new Uint8Array(readFileSync(join(import.meta.dir, "../agreements/files", fileNameFor(f))));
  return (await extractText(bytes, detectFormat(bytes, fileNameFor(f)).format)).text;
};

test("health reports the engine", async () => {
  expect(await anonymizer.health()).toMatchObject({ ok: true });
});

describe("fixtures with personal data", () => {
  for (const f of fixtures.filter((x) => x.pii?.length)) {
    test(`${f.slug}: every listed value is replaced`, async () => {
      const text = await textOf(f.slug);
      const out = await anonymizer.anonymize(text);
      expect(out.language).toBe(f.language ?? "en");
      for (const value of f.pii!) expect(text).toContain(value);
      expect(f.pii!.filter((v) => out.text.toLowerCase().includes(v.toLowerCase()))).toEqual([]);
      expect(leakedValues(out.text, out.entities)).toEqual([]);
      // The company's own name stays readable, so the model knows which party is the Company.
      expect(out.text).toContain("Northwind Analytics");
    });
  }
});

describe("the text still works as an agreement", () => {
  test("nda-pl-compliant: same sections before and after, clause text intact", async () => {
    const text = await textOf("nda-pl-compliant");
    const out = await anonymizer.anonymize(text);
    const before = segmentSections(text);
    const after = segmentSections(out.text);
    expect(after.map((s) => [s.id, s.number, s.heading])).toEqual(before.map((s) => [s.id, s.number, s.heading]));
    expect(out.text).toContain("Umowa podlega prawu polskiemu.");
    expect(out.text).toContain("sąd powszechny właściwy dla Warszawy");
    expect(out.text).toContain("200 000 zł");
  });

  test("inflected Polish names share one placeholder", async () => {
    const out = await anonymizer.anonymize(await textOf("nda-pl-compliant"));
    const anna = out.entities.find((e) => e.variants.includes("Annę Kowalską"));
    expect(anna?.variants).toContain("Anna Kowalska");
    const magda = out.entities.find((e) => e.variants.includes("Magdaleny Wójcik"));
    expect(magda?.variants).toContain("Magdalena Wójcik");
  });

  test("the same input gives the same placeholders", async () => {
    const text = await textOf("employment-pl-noncompete-too-long");
    const [a, b] = await Promise.all([anonymizer.anonymize(text), anonymizer.anonymize(text)]);
    expect(a.text).toBe(b.text);
  });

  test("placeholders map back to the original values", async () => {
    const text = await textOf("employment-compliant");
    const out = await anonymizer.anonymize(text);
    expect(out.text.match(PLACEHOLDER)?.length).toBeGreaterThan(0);
    expect(rehydrate(out.text, out.entities)).toBe(text);
  });
});
