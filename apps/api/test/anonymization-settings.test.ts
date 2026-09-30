import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HttpAnonymizer } from "@app/anonymization";
import type {
  AgreementDto,
  AgreementTextDto,
  AnonymizationConfigDto,
  AnonymizationPreviewDto,
  AnonymizationSettingsDto,
} from "@app/contracts";
import { environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fixtureResponder } from "@app/seeds/stub";
import { startAnonymizerService } from "@app/test-utils";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness, errorOf } from "./harness.ts";

/** The admin settings page: stored techniques, the live preview, and the worker applying them. */
let h: Awaited<ReturnType<typeof createHarness>>;
let service: Awaited<ReturnType<typeof startAnonymizerService>>;
let admin: string;
let auditor: string;
let worker: Worker;

beforeAll(async () => {
  service = await startAnonymizerService();
  const anonymizer = new HttpAnonymizer(service.url);
  h = await createHarness({ anonymizer });
  await seedAllRules(h.t);
  admin = await h.login("admin@example.com");
  auditor = await h.login("auditor@example.com");
  worker = new Worker({
    database: h.t,
    workerId: "settings-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({}), anonymizer),
      run_audit: runAuditHandler(async () => new StubAuditClient(fixtureResponder), { anonymizer }),
    },
  });
});
afterAll(async () => {
  await Promise.all([h?.close(), service?.stop()]);
});

const settings = async () => (await (await h.call("GET", "/settings/anonymization", { cookie: admin })).json()) as AnonymizationSettingsDto;
const save = (config: AnonymizationConfigDto, version: number) =>
  h.call("PUT", "/settings/anonymization", { cookie: admin, body: { ...config, version } });

const SAMPLE = "Umowa z Wisła Data Solutions S.A., reprezentowaną przez Annę Kowalską, PESEL 44051401359, e-mail anna@example.pl.";

describe("anonymization settings, in order", () => {
  test("defaults: every technique on, the service is reachable and lists its types", async () => {
    const s = await settings();
    expect(s.isDefault).toBe(true);
    expect(s.config).toMatchObject({ disabledLabels: [], personCues: true, propagate: true, inflection: true, ner: true });
    expect(s.service).toMatchObject({ reachable: true, engine: "rules" });
    expect(s.labels).toContain("PESEL");
  });

  test("only admins can see or change the settings", async () => {
    expect((await h.call("GET", "/settings/anonymization", { cookie: auditor })).status).toBe(403);
  });

  test("the preview runs draft settings without saving them", async () => {
    const before = await settings();
    const draft = { ...before.config, disabledLabels: ["PESEL"] };
    const res = await h.call("POST", "/settings/anonymization/preview", { cookie: admin, body: { text: SAMPLE, config: draft } });
    expect(res.status).toBe(200);
    const out = (await res.json()) as AnonymizationPreviewDto;
    expect(out.text).toContain("44051401359");
    expect(out.text).not.toContain("Annę Kowalską");
    expect((await settings()).version).toBe(before.version);
  });

  describe("saving", () => {
    test("stores the settings, records an event, and rejects a stale version", async () => {
      const s = await settings();
      const config = { ...s.config, disabledLabels: ["EMAIL"], inflection: false, keep: ["Wisła Data Solutions"] };
      const res = await save(config, s.version);
      expect(res.status).toBe(200);
      const saved = (await res.json()) as AnonymizationSettingsDto;
      expect(saved).toMatchObject({ isDefault: false, config });
      expect((await save({ ...config, ner: false }, s.version)).status).toBe(409);

      const log = (await (await h.call("GET", "/audit-log?eventType=AnonymizationConfigured", { cookie: admin })).json()) as {
        items: { summary: string }[];
      };
      expect(log.items[0]!.summary).toContain("off: EMAIL, Polish inflection");
    });

    test("invalid settings are refused with field errors", async () => {
      const s = await settings();
      const badLabel = await save({ ...s.config, disabledLabels: ["NOPE"] }, s.version);
      expect(badLabel.status).toBe(422);
      expect((await errorOf(badLabel)).details.map((d) => d.path)).toEqual(["disabledLabels.0"]);
      const badKeep = await save({ ...s.config, keep: ["x"] }, s.version);
      expect((await errorOf(badKeep)).details.map((d) => d.path)).toEqual(["keep.0"]);
    });

    test("the worker applies the saved settings to new uploads", async () => {
      const a = (await (await h.upload("nda-pl-compliant.md", "NDA", auditor)).json()) as AgreementDto;
      await worker.drain();
      const text = (await (await h.call("GET", `/agreements/${a.id}/text?view=anonymized`, { cookie: admin })).json()) as AgreementTextDto;
      expect(text.text).toContain("piotr.zielinski@northwind.example"); // EMAIL switched off
      expect(text.text).toContain("Wisła Data Solutions"); // on the keep list
      expect(text.text).not.toContain("5260250274");
    });

    test("reset returns to the defaults", async () => {
      const s = await settings();
      const res = await h.call("POST", "/settings/anonymization/reset", { cookie: admin, body: { version: s.version } });
      expect(res.status).toBe(200);
      expect((await res.json()) as AnonymizationSettingsDto).toMatchObject({ isDefault: true, config: { disabledLabels: [] } });
    });
  });

  test("without an anonymizer the page says so and the preview is refused", async () => {
    const bare = await createHarness();
    try {
      const cookie = await bare.login("admin@example.com");
      const s = (await (await bare.call("GET", "/settings/anonymization", { cookie })).json()) as AnonymizationSettingsDto;
      expect(s.service).toMatchObject({ reachable: false, url: null });
      const res = await bare.call("POST", "/settings/anonymization/preview", { cookie, body: { text: SAMPLE, config: s.config } });
      expect(res.status).toBe(409);
    } finally {
      await bare.close();
    }
  });
});
