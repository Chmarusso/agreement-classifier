import { describe, expect, test } from "bun:test";
import { sectionLabel, segmentSections } from "../src/sections.ts";

describe("segmentation rules", () => {
  test("keyword headings like Article and § are recognised", () => {
    const text = "Contract\n\nArticle 1 Scope\nThe scope.\n\nArticle 2 Price\nThe price.\n\n§ 3 Law\nPolish law applies.";
    expect(segmentSections(text).map((s) => [s.id, s.number, s.heading])).toEqual([
      ["S0", null, "Preamble"],
      ["S1", "1", "Scope"],
      ["S2", "2", "Price"],
      ["S3", "3", "Law"],
    ]);
  });

  test("sub-clauses keep their full number", () => {
    const text = "1. Term\nIntro.\n1.1 Start\nStarts now.\n1.2 End\nEnds later.";
    expect(segmentSections(text).map((s) => s.number)).toEqual(["1", "1.1", "1.2"]);
  });

  test("numbered sentences are not mistaken for headings", () => {
    const text =
      "1. Scope\nA.\n2. Fees\n3. The Supplier shall deliver the goods to the Company within thirty days of each order.\n4. Law\nB.";
    expect(segmentSections(text).map((s) => s.number)).toEqual(["1", "2", "4"]);
  });

  test("documents without headings fall back to paragraphs", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"word ".repeat(80)}`).join("\n\n");
    const sections = segmentSections(text);
    expect(sections.every((s) => s.id.startsWith("P"))).toBe(true);
    expect(sections.length).toBeGreaterThan(1);
    expect(sectionLabel(sections[0]!)).toBe("Paragraph 1");
  });

  test("Polish headings: § with the title on the next line, Artykuł, Załącznik nr, Podpisy stron", () => {
    const text = [
      "UMOWA O ZACHOWANIU POUFNOŚCI",
      "zawarta w Warszawie pomiędzy Stronami.",
      "§ 1",
      "Przedmiot umowy",
      "Strony zamierzają nawiązać współpracę.",
      "§ 2",
      "Informacje poufne",
      "Informacje poufne oznaczają wszelkie informacje.",
      "Artykuł 3 Prawo właściwe",
      "Umowa podlega prawu polskiemu.",
      "Podpisy stron",
      "Za Spółkę: ______",
      "Załącznik nr 1 – Lista osób",
      "1. Osoby upoważnione",
      "Lista.",
    ].join("\n");
    expect(segmentSections(text).map((s) => [s.id, s.number, s.heading, s.scope])).toEqual([
      ["S0", null, "Preamble", null],
      ["S1", "1", "Przedmiot umowy", null],
      ["S2", "2", "Informacje poufne", null],
      ["S3", "3", "Prawo właściwe", null],
      ["S4", null, "Podpisy stron", null],
      ["S5", null, "Lista osób", "Załącznik 1"],
      ["S6", "1", "Osoby upoważnione", "Załącznik 1"],
    ]);
  });

  test("a bare § followed by Podpisy stron is one signature clause", () => {
    const text = "Wstęp.\n§ 1\nCel\nTekst.\n§ 2\nPrawo\nTekst.\n§ 3\nPodpisy stron\nZa Spółkę: ____";
    expect(segmentSections(text).map((s) => [s.number, s.heading])).toEqual([
      [null, "Preamble"],
      ["1", "Cel"],
      ["2", "Prawo"],
      ["3", "Podpisy stron"],
    ]);
  });

  test("a § line followed by a sentence keeps no heading", () => {
    const text = "Intro.\n§ 1\nThe parties agree to cooperate on the project.\n§ 2\nFees.\nMore.\n§ 3\nLaw.\nPolish law.";
    expect(segmentSections(text)[1]).toMatchObject({ number: "1", heading: null });
  });

  test("labels read like citations", () => {
    expect(sectionLabel({ id: "S4", number: "4", heading: "Termination" })).toBe("§4 Termination");
  });
});
