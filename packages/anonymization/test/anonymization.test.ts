import { describe, expect, test } from "bun:test";
import {
  AnonymizerUnavailableError,
  anonymizerFromEnv,
  applyPlaceholders,
  entityCounts,
  HttpAnonymizer,
  leakedValues,
  rehydrate,
  rehydrateDeep,
} from "../src/index.ts";

const entities = [
  { placeholder: "<PERSON_1>", label: "PERSON", value: "Jan Kowalski", count: 2, variants: ["Jan Kowalski", "Jana Kowalskiego"] },
  { placeholder: "<PERSON_10>", label: "PERSON", value: "Anna Nowak", count: 1, variants: ["Anna Nowak"] },
  { placeholder: "<PESEL_1>", label: "PESEL", value: "44051401359", count: 1, variants: ["44051401359"] },
];

describe("rehydrate", () => {
  test("puts values back and tells <PERSON_1> from <PERSON_10>", () => {
    expect(rehydrate("Signed by <PERSON_1> and <PERSON_10>, PESEL <PESEL_1>.", entities)).toBe(
      "Signed by Jan Kowalski and Anna Nowak, PESEL 44051401359.",
    );
  });

  test("leaves unknown placeholders and plain text alone", () => {
    expect(rehydrate("<ORG_3> and <S4>", entities)).toBe("<ORG_3> and <S4>");
  });

  test("walks nested findings", () => {
    const findings = [{ explanation: "<PERSON_1> signs", evidence: [{ quote: "Name: <PERSON_1>", sectionId: "S9" }], confidence: 0.9 }];
    expect(rehydrateDeep(findings, entities)).toEqual([
      { explanation: "Jan Kowalski signs", evidence: [{ quote: "Name: Jan Kowalski", sectionId: "S9" }], confidence: 0.9 },
    ]);
    expect(rehydrateDeep(null, entities)).toBeNull();
  });
});

describe("applyPlaceholders", () => {
  test("replaces every variant, whole words only", () => {
    expect(applyPlaceholders("Umowa: Jana Kowalskiego i Anna Nowakowa", entities)).toBe("Umowa: <PERSON_1> i Anna Nowakowa");
  });
});

test("entityCounts groups by label", () => {
  expect(entityCounts(entities)).toEqual({ PERSON: 2, PESEL: 1 });
});

test("leakedValues finds values and variants, ignoring case", () => {
  expect(leakedValues("sent: JANA KOWALSKIEGO", entities)).toEqual(["Jana Kowalskiego"]);
  expect(leakedValues("sent: <PERSON_1>", entities)).toEqual([]);
});

describe("HttpAnonymizer", () => {
  test("an unreachable service is reported, not ignored", async () => {
    const a = new HttpAnonymizer("http://127.0.0.1:9", { timeoutMs: 2000 });
    await expect(a.anonymize("Jan Kowalski")).rejects.toBeInstanceOf(AnonymizerUnavailableError);
  });

  test("anonymizerFromEnv is off without a URL and splits the keep list", () => {
    expect(anonymizerFromEnv({})).toBeNull();
    expect(anonymizerFromEnv({ ANONYMIZER_URL: " " })).toBeNull();
    expect(anonymizerFromEnv({ ANONYMIZER_URL: "http://localhost:8090", ANONYMIZER_KEEP: "Northwind Analytics; Acme" })?.label).toBe(
      "anonymizer@localhost:8090",
    );
  });
});
