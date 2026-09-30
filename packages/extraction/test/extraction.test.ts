import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat, ExtractionError, extractText } from "../src/index.ts";

const dir = join(import.meta.dir, "../../../seeds/agreements/files");
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

describe("fixture extraction", () => {
  for (const name of readdirSync(dir).filter((n) => !n.startsWith("scanned"))) {
    test(`${name} extracts readable text`, async () => {
      const bytes = load(name);
      const { format } = detectFormat(bytes, name);
      expect(format).toBe(name.split(".").pop() as never);
      const out = await extractText(bytes, format);
      expect(out.text).toContain("Northwind Analytics");
      expect(out.text.length).toBeGreaterThan(800);
    });
  }

  test("scanned PDF fails with no_text_layer", async () => {
    const bytes = load("scanned-no-text-layer.pdf");
    const err = await extractText(bytes, detectFormat(bytes, "x.pdf").format).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).reason).toBe("no_text_layer");
  });
});

describe("format detection", () => {
  test("rejects an executable renamed to .pdf", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(() => detectFormat(exe, "contract.pdf")).toThrow(ExtractionError);
  });
  test("rejects binary content named .txt", () => {
    expect(() => detectFormat(new Uint8Array([1, 0, 2, 0]), "a.txt")).toThrow(/Only PDF/);
  });
  test("rejects a zip that is not a docx", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode("readme.txt")]);
    expect(() => detectFormat(zip, "a.docx")).toThrow(/ZIP/);
  });
  test("text longer than the limit fails with too_large", async () => {
    const big = new TextEncoder().encode("clause text ".repeat(20_000));
    const err = await extractText(big, "txt").catch((e) => e);
    expect((err as ExtractionError).reason).toBe("too_large");
  });
});
