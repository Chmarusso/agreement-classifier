import { describe, expect, test } from "bun:test";
import { detectLanguage } from "../src/language.ts";

describe("detectLanguage", () => {
  test("Polish agreement text", () => {
    expect(detectLanguage("Umowa zostaje zawarta na czas nieokreślony. Każda ze Stron może ją wypowiedzieć z zachowaniem terminu.")).toBe(
      "pl",
    );
  });

  test("English agreement text", () => {
    expect(detectLanguage("This Agreement shall be governed by the laws of Poland and any dispute shall be settled by the courts.")).toBe(
      "en",
    );
  });

  test("an English agreement naming a Polish company stays English", () => {
    expect(
      detectLanguage(
        "This Agreement is made between Northwind Analytics sp. z o.o., Warszawa, ul. Żurawia 6/12, and the Supplier, and shall bind the parties.",
      ),
    ).toBe("en");
  });

  test("empty text defaults to English", () => {
    expect(detectLanguage("")).toBe("en");
  });
});
