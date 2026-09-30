import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat, extractText, sectionLabel, segmentSections } from "@app/extraction";
import { fileNameFor, fixtures } from "../fixtures/agreements.ts";

const dir = join(import.meta.dir, "../agreements/files");

describe("section segmentation on the fixtures", () => {
  for (const f of fixtures.filter((x) => x.format !== "pdf-scan" && x.format !== "pdf-long")) {
    test(`${f.slug}: one section per numbered clause plus the preamble`, async () => {
      const bytes = new Uint8Array(readFileSync(join(dir, fileNameFor(f))));
      const { text } = await extractText(bytes, detectFormat(bytes, fileNameFor(f)).format);
      const sections = segmentSections(text);
      const clauses = (f.markdown.match(/^## /gm) ?? []).length;
      expect(sections[0]).toMatchObject({ id: "S0", heading: "Preamble" });
      expect(sections).toHaveLength(clauses + 1);
      expect(sections.slice(1).map((s) => s.number)).toEqual(Array.from({ length: clauses }, (_, i) => String(i + 1)));
      const law = sections.find((s) => s.heading === "Governing law");
      if (law) expect(law.text).toContain("governed by the laws of Poland");
    });
  }
});

describe("real-length PDF agreements", () => {
  const long = fixtures.filter((f) => f.format === "pdf-long");
  const load = async (slug: string) => {
    const f = long.find((x) => x.slug === slug)!;
    const bytes = new Uint8Array(readFileSync(join(dir, fileNameFor(f))));
    const out = await extractText(bytes, "pdf");
    return { ...out, sections: segmentSections(out.text) };
  };
  const where = <T extends { text: string }>(sections: T[], q: string): T | undefined =>
    sections.find((s) => s.text.replace(/\s+/g, " ").includes(q));

  for (const f of long) {
    test(`${f.slug} is 20 to 30 pages without headers, footers or page numbers in the text`, async () => {
      const { pageCount, text, sections } = await load(f.slug);
      expect(pageCount).toBeGreaterThanOrEqual(20);
      expect(pageCount).toBeLessThanOrEqual(30);
      expect(text).not.toContain("| Confidential");
      expect(text).not.toMatch(/Page \d+ of \d+/);
      expect(sections.filter((s) => s.scope && !s.number).map((s) => s.scope)).toEqual(
        Array.from({ length: (f.markdown.match(/^# Schedule/gm) ?? []).length }, (_, i) => `Schedule ${i + 1}`),
      );
      expect(where(sections, "Title: Chief Executive Officer")?.heading).toBe("Signatures");
    });
  }

  test("planted MSA terms land in their schedule sub-clauses", async () => {
    const { sections } = await load("long-msa-deep-medium-issues");
    expect(sectionLabel(where(sections, "seventy-five (75) days")!)).toBe("Schedule 2 §2.4 Charges and payment terms");
    expect(sectionLabel(where(sections, "not less than EUR 250,000")!)).toBe("Schedule 4 §4.1 Insurance");
    expect(sectionLabel(where(sections, "within the period set out in Schedule 2")!)).toBe("§7.3 Charges and payment");
  });

  test("the SaaS override and the clause it overrides are separate citable sections", async () => {
    const { sections } = await load("long-saas-termination-override");
    expect(sectionLabel(where(sections, "Either party may terminate this Agreement for convenience by giving")!)).toBe("§15.1 Termination");
    expect(sectionLabel(where(sections, "may not terminate this Agreement for convenience during the Minimum Commitment Period")!)).toBe(
      "Schedule 6 §6.3 Special conditions",
    );
  });

  test("a wrapped line mentioning a schedule mid-sentence is not a schedule heading", () => {
    const text =
      "1. Scope\nThe Provider shall meet the availability commitment in\nSchedule 3 and shall pay the credits.\n2. Fees\nText.\n3. Law\nText.";
    expect(segmentSections(text).some((s) => s.scope)).toBe(false);
  });
});
