import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Anonymizer, HttpAnonymizer } from "@app/anonymization";
import type {
  AgreementDetailDto,
  AgreementDto,
  AgreementTextDto,
  AuditLogEntryDto,
  AuditRunDetailDto,
  PromptAttemptDto,
} from "@app/contracts";
import { environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fixtures } from "@app/seeds/fixtures";
import { fixtureResponder } from "@app/seeds/stub";
import { startAnonymizerService } from "@app/test-utils";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness } from "./harness.ts";

/** Upload to report with the real Python anonymizer between extraction and the model. */
let h: Awaited<ReturnType<typeof createHarness>>;
let service: Awaited<ReturnType<typeof startAnonymizerService>>;
let admin: string;
let worker: Worker;
/** Swapped per test to simulate an outage. */
let anonymizer: Anonymizer;

const client = new StubAuditClient(fixtureResponder);
const switchable: Anonymizer = { label: "switchable", anonymize: (text, opts) => anonymizer.anonymize(text, opts) };

beforeAll(async () => {
  [h, service] = await Promise.all([createHarness(), startAnonymizerService()]);
  anonymizer = new HttpAnonymizer(service.url, { keep: ["Northwind Analytics"] });
  await seedAllRules(h.t);
  admin = await h.login("admin@example.com");
  worker = new Worker({
    database: h.t,
    workerId: "anonymizing-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({}), switchable),
      run_audit: runAuditHandler(async () => client, { anonymizer: switchable }),
    },
  });
});
afterAll(async () => {
  await Promise.all([h?.close(), service?.stop()]);
});

const get = async <T>(path: string) => (await (await h.call("GET", path, { cookie: admin })).json()) as T;

async function uploadAndDrain(fileName: string, type: string): Promise<AgreementDetailDto> {
  const res = await h.upload(fileName, type, admin);
  expect(res.status).toBe(201);
  const a = (await res.json()) as AgreementDto;
  await worker.drain();
  return get<AgreementDetailDto>(`/agreements/${a.id}`);
}

describe.each([
  ["nda-pl-compliant", "nda-pl-compliant.md", "NDA"],
  ["employment-pl-noncompete-too-long", "employment-pl-noncompete-too-long.docx", "Employment"],
])("%s", (slug, fileName, type) => {
  const fixture = fixtures.find((f) => f.slug === slug)!;
  let detail: AgreementDetailDto;
  beforeAll(async () => {
    detail = await uploadAndDrain(fileName, type);
  });

  test("is detected as Polish and anonymized before the audit", () => {
    expect(detail.language).toBe("pl");
    expect(detail.anonymizedEntityCount).toBeGreaterThanOrEqual(5);
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]!.status).toBe("completed");
  });

  test("no personal data reaches the prompt", async () => {
    const prompts = await get<PromptAttemptDto[]>(`/audits/${detail.runs[0]!.id}/prompts`);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      const sent = `${p.systemPrompt}\n${p.prompt}`.toLowerCase();
      expect(fixture.pii!.filter((v) => sent.includes(v.toLowerCase()))).toEqual([]);
      expect(p.prompt).toMatch(/<PERSON_\d+>/);
    }
  });

  test("both text versions can be previewed", async () => {
    const original = await get<AgreementTextDto>(`/agreements/${detail.id}/text`);
    const anonymized = await get<AgreementTextDto>(`/agreements/${detail.id}/text?view=anonymized`);
    expect(original).toMatchObject({ view: "original", language: "pl" });
    expect(anonymized).toMatchObject({ view: "anonymized", language: "pl" });
    for (const v of fixture.pii!) expect(original.text).toContain(v);
    expect(fixture.pii!.filter((v) => anonymized.text.includes(v))).toEqual([]);
    expect(anonymized.sections.map((s) => s.id)).toEqual(original.sections.map((s) => s.id));
    expect(anonymized.anonymization!.entities.length).toBe(detail.anonymizedEntityCount!);
  });

  test("the report shows real values by default and placeholders on request", async () => {
    const run = detail.runs[0]!;
    const report = await get<AuditRunDetailDto>(`/audits/${run.id}`);
    const raw = await get<AuditRunDetailDto>(`/audits/${run.id}?view=anonymized`);
    expect(report).toMatchObject({ view: "original", anonymized: true });
    if (fixture.expected.extraction === "extracted") expect(report.verdict).toBe(fixture.expected.verdict);
    expect(raw.view).toBe("anonymized");
    expect(JSON.stringify(report.findings)).not.toMatch(/<[A-Z_]+_\d+>/);
    expect(raw.findings.map((f) => f.status)).toEqual(report.findings.map((f) => f.status));
  });

  test("the audit log records what was replaced, without the values", async () => {
    const log = await get<{ items: AuditLogEntryDto[] }>(`/audit-log?eventType=AgreementAnonymized`);
    const entry = log.items.find((e) => e.streamId === detail.id);
    expect(entry?.summary).toMatch(/^Personal data anonymized in .+: .*\d+ PERSON/);
    expect(fixture.pii!.filter((v) => JSON.stringify(entry).includes(v))).toEqual([]);
  });
});

test("an unknown view is rejected", async () => {
  const detail = (await get<{ items: AgreementDto[] }>("/agreements")).items[0]!;
  expect((await h.call("GET", `/agreements/${detail.id}/text?view=raw`, { cookie: admin })).status).toBe(422);
});

test("when the anonymizer is down, the job retries and then fails without calling the model", async () => {
  anonymizer = new HttpAnonymizer("http://127.0.0.1:9", { timeoutMs: 1000 });
  try {
    const res = await h.upload("nda-pl-compliant.md", "NDA", admin);
    const a = (await res.json()) as AgreementDto;
    // Each failed attempt is retried after a delay; run the retries now.
    for (let i = 0; i < 5; i++) {
      await worker.drain();
      await h.t.sql`update jobs set run_after = now() where status = 'pending'`;
    }
    const detail = await get<AgreementDetailDto>(`/agreements/${a.id}`);
    expect(detail.extractionStatus).toBe("failed");
    expect(detail.extractionError).toMatch(/^anonymization_failed: .*not sent to any model/);
    expect(detail.runs).toEqual([]);
    expect((await h.call("GET", `/agreements/${a.id}/text?view=anonymized`, { cookie: admin })).status).toBe(404);
  } finally {
    anonymizer = new HttpAnonymizer(service.url, { keep: ["Northwind Analytics"] });
  }
});
