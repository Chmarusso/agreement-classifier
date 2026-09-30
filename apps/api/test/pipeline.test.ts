import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  AgreementDetailDto,
  AgreementDto,
  AuditRunDetailDto,
  AuditRunSummaryDto,
  CostsDto,
  PromptAttemptDto,
  RuleDto,
} from "@app/contracts";
import { type AuditModelClient, type AuditModelRequest, type AuditModelResult, environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fileNameFor, fixtures } from "@app/seeds/fixtures";
import { fixtureResponder } from "@app/seeds/stub";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness, errorOf } from "./harness.ts";

/** A switchable client so each test can script the model's behaviour. */
class ScriptedClient implements AuditModelClient {
  label = "stub";
  costPerCall = 0;
  /** `n` counts calls since the script was set, so "first call" means first call of this test. */
  private _script: ((req: AuditModelRequest, n: number) => unknown) | null = null;
  private calls = 0;
  set script(fn: ((req: AuditModelRequest, n: number) => unknown) | null) {
    this._script = fn;
    this.calls = 0;
  }
  private stub = new StubAuditClient((req) => {
    this.calls++;
    return this._script ? this._script(req, this.calls) : fixtureResponder(req, this.calls);
  });
  async audit(req: AuditModelRequest): Promise<AuditModelResult> {
    const r = await this.stub.audit(req);
    if (!r.ok && r.error === "AUTH") return { ...r, errorCode: "auth", retryable: false, error: "Not logged in · Please run /login" };
    return { ...r, costUsd: this.costPerCall };
  }
}

let h: Awaited<ReturnType<typeof createHarness>>;
let auditor: string;
let admin: string;
let worker: Worker;
const client = new ScriptedClient();
const voting = { mode: "uncertain" as "off" | "uncertain" | "all", samples: 2, temperature: 0.7 };

beforeAll(async () => {
  h = await createHarness();
  await seedAllRules(h.t);
  auditor = await h.login("auditor@example.com");
  admin = await h.login("admin@example.com");
  worker = new Worker({
    database: h.t,
    workerId: "test-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({})),
      run_audit: runAuditHandler(async () => client, { voting }),
    },
  });
});
afterAll(async () => {
  await h.close();
});

const upload = (fileName: string, agreementType: string, bytes?: Uint8Array, cookie = auditor) =>
  h.upload(fileName, agreementType, cookie, bytes);

const get = async <T>(path: string, cookie = admin) => (await (await h.call("GET", path, { cookie })).json()) as T;

/** Uploads a fixture and drains the worker: extraction, then the audit it requests automatically. */
async function uploadAndAudit(fileName: string, type: string): Promise<AuditRunDetailDto> {
  const res = await upload(fileName, type);
  expect(res.status).toBe(201);
  const a = (await res.json()) as AgreementDto;
  await worker.drain();
  const detail = await get<AgreementDetailDto>(`/agreements/${a.id}`);
  expect(detail.runs).toHaveLength(1);
  return get<AuditRunDetailDto>(`/audits/${detail.runs[0]!.id}`);
}

/** Requests a further run by hand, as an auditor re-running an agreement would. */
async function requestRun(agreementId: string): Promise<AuditRunSummaryDto> {
  const res = await h.call("POST", `/agreements/${agreementId}/audits`, { cookie: auditor, body: {} });
  expect(res.status).toBe(201);
  return (await res.json()) as AuditRunSummaryDto;
}

describe("happy path over the fixture matrix (stub model)", () => {
  for (const f of fixtures) {
    test(`${f.slug}: ${f.expected.extraction === "failed" ? "extraction fails" : `verdict ${f.expected.verdict}`}`, async () => {
      client.script = null;
      const res = await upload(fileNameFor(f), f.type);
      expect(res.status).toBe(201);
      const agreement = (await res.json()) as AgreementDto;
      expect(agreement.extractionStatus).toBe("pending");
      await worker.drain();
      const detail = await get<AgreementDetailDto>(`/agreements/${agreement.id}`);

      if (f.expected.extraction === "failed") {
        expect(detail.extractionStatus).toBe("failed");
        expect(detail.extractionError).toStartWith("no_text_layer");
        const blocked = await h.call("POST", `/agreements/${agreement.id}/audits`, { cookie: auditor, body: {} });
        expect(blocked.status).toBe(409);
        return;
      }
      expect(detail.extractionStatus).toBe("extracted");
      expect(detail.applicableRuleCount).toBe(Object.keys(f.expected.findings).length);
      expect(detail.runs).toHaveLength(1); // requested by the worker right after extraction
      expect(detail.latestRunStatus).toBe("completed");

      const report = await get<AuditRunDetailDto>(`/audits/${detail.runs[0]!.id}`);
      expect(report.status).toBe("completed");
      expect(report.verdict).toBe(f.expected.verdict);
      const bySlugTitle = new Map(report.findings.map((x) => [x.ruleTitle, x]));
      const rules = await get<RuleDto[]>("/rules");
      for (const [slug, exp] of Object.entries(f.expected.findings)) {
        const rule = rules.find((r) => r.slug === slug)!;
        const finding = bySlugTitle.get(rule.title)!;
        expect(finding.status).toBe(exp.status);
        if (exp.quote) expect(finding.evidence.every((e) => e.verified)).toBe(true);
      }
      const events = report.timeline.map((t) => t.eventType);
      expect(events.slice(0, 4)).toEqual(["AuditRunRequested", "AuditRunStarted", "AuditRunClaudeCalled", "AuditRunClaudeResponded"]);
      expect(events.at(-1)).toBe("AuditRunCompleted");
      const hasUncertain = Object.values(f.expected.findings).some((x) => x.status === "unclear" || x.status === "partial");
      expect(events.includes("AuditRunFindingsVoted")).toBe(hasUncertain);
      expect(report.inputTokens).toBeGreaterThan(0);
      const after = await get<AgreementDetailDto>(`/agreements/${agreement.id}`);
      expect(after.latestVerdict).toBe(f.expected.verdict);
    });
  }
});

describe("audit pipeline edge cases", () => {
  test("invalid model output is rejected, retried with the errors, then accepted", async () => {
    client.script = (req, n) => (n === 1 ? { schemaVersion: 1, summary: "missing findings" } : fixtureResponder(req, n));
    const report = await uploadAndAudit("nda-compliant.pdf", "NDA");
    expect(report.status).toBe("completed");
    expect(report.modelCalls).toBe(2);
    expect(report.rejectedOutputs).toBe(1);
    expect(report.timeline.map((t) => t.eventType)).toContain("AuditRunClaudeOutputRejected");
    const prompts = await get<PromptAttemptDto[]>(`/audits/${report.id}/prompts`);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.prompt).toContain("Your previous answer was rejected");
  });

  test("three invalid answers fail the run; retry succeeds once the model behaves", async () => {
    client.script = () => ({ nonsense: true });
    const failed = await uploadAndAudit("saas-auto-renewal.pdf", "SaaS");
    expect(failed.status).toBe("failed");
    expect(failed.modelCalls).toBe(3);
    expect(failed.failureReason).toContain("after 3 attempts");

    client.script = null;
    const retry = await h.call("POST", `/audits/${failed.id}/retry`, { cookie: auditor, body: { version: failed.version } });
    expect(retry.status).toBe(200);
    await worker.drain();
    const done = await get<AuditRunDetailDto>(`/audits/${failed.id}`);
    expect(done).toMatchObject({ status: "completed", verdict: "fail", modelCalls: 4 });
  });

  test("an authentication failure stops immediately without retries", async () => {
    client.script = () => new Error("AUTH");
    const report = await uploadAndAudit("msa-compliant.pdf", "MSA");
    expect(report.status).toBe("failed");
    expect(report.modelCalls).toBe(1);
    expect(report.failureReason).toContain("Not logged in");
  });

  test("costs are summed per run, per agreement and on the costs endpoint", async () => {
    client.script = (req, n) => (n === 1 ? { bad: 1 } : fixtureResponder(req, n));
    client.costPerCall = 0.0125;
    const before = await get<CostsDto>("/audits/costs");
    const report = await uploadAndAudit("employment-compliant.docx", "Employment");
    client.costPerCall = 0;
    expect(report.totalCostUsd).toBeCloseTo(0.025, 6);
    expect(report.agreement.totalCostUsd).toBeCloseTo(0.025, 6);
    const after = await get<CostsDto>("/audits/costs");
    expect(after.total.costUsd - before.total.costUsd).toBeCloseTo(0.025, 6);
    expect(after.thisMonth.runs).toBe(before.thisMonth.runs + 1);
    expect(after.byModel.find((m) => m.model === "stub")?.runs).toBeGreaterThan(0);
    const completed = report.timeline.find((t) => t.eventType === "AuditRunCompleted")!;
    expect((completed.payload as { totalCostUsd: number }).totalCostUsd).toBeCloseTo(0.025, 6);
  });

  test("auditors and viewers get verdicts but no spend, model or prompt details", async () => {
    client.script = null;
    client.costPerCall = 0.01;
    const report = await uploadAndAudit("nda-compliant.pdf", "NDA");
    client.costPerCall = 0;
    expect(report.totalCostUsd).toBeCloseTo(0.01, 6);

    const asAuditor = await get<AuditRunDetailDto>(`/audits/${report.id}`, auditor);
    expect(asAuditor.verdict).toBe("pass");
    expect(asAuditor.findings.length).toBeGreaterThan(0);
    for (const key of ["totalCostUsd", "inputTokens", "outputTokens", "modelDurationMs", "model"])
      expect(asAuditor).not.toHaveProperty(key);
    expect(asAuditor.agreement).not.toHaveProperty("totalCostUsd");
    expect(asAuditor.timeline.map((t) => t.eventType)).toEqual(["AuditRunRequested", "AuditRunStarted", "AuditRunCompleted"]);
    expect(asAuditor.timeline.some((t) => t.summary.includes("$") || t.payload !== null)).toBe(false);

    const list = await get<{ items: AgreementDto[] }>("/agreements", auditor);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((a) => !("totalCostUsd" in a))).toBe(true);
    const runs = await get<AuditRunSummaryDto[]>("/audits", auditor);
    expect(runs.every((r) => !("totalCostUsd" in r) && !("model" in r))).toBe(true);

    expect((await h.call("GET", "/audits/costs", { cookie: auditor })).status).toBe(403);
    expect((await h.call("GET", `/audits/${report.id}/prompts`, { cookie: auditor })).status).toBe(403);
    const viewer = await h.login("viewer@example.com");
    expect((await h.call("GET", "/audits/costs", { cookie: viewer })).status).toBe(403);
  });

  test("a cancelled run is never sent to the model", async () => {
    client.script = null;
    const a = (await (await upload("nda-compliant.pdf", "NDA")).json()) as AgreementDto;
    await worker.drain();
    const run = await requestRun(a.id);
    const cancel = await h.call("POST", `/audits/${run.id}/cancel`, { cookie: auditor, body: { version: run.version } });
    expect(cancel.status).toBe(200);
    await worker.drain();
    const report = await get<AuditRunDetailDto>(`/audits/${run.id}`);
    expect(report).toMatchObject({ status: "cancelled", modelCalls: 0 });
  });

  test("editing a rule after the request does not change the running audit", async () => {
    client.script = null;
    const admin = await h.login("admin@example.com");
    const a = (await (await upload("nda-compliant.pdf", "NDA")).json()) as AgreementDto;
    await worker.drain();
    const run = await requestRun(a.id);
    const rule = (await get<RuleDto[]>("/rules")).find((r) => r.slug === "governing-law")!;
    const edit = await h.call("PATCH", `/rules/${rule.id}`, {
      cookie: admin,
      body: {
        title: rule.title,
        description: "EDITED AFTER REQUEST",
        severity: rule.severity,
        category: rule.category,
        appliesTo: rule.appliesTo,
        version: rule.version,
      },
    });
    expect(edit.status).toBe(200);
    await worker.drain();
    const [attempt] = await get<PromptAttemptDto[]>(`/audits/${run.id}/prompts`);
    expect(attempt!.prompt).toContain("governed by the laws of Poland");
    expect(attempt!.prompt).not.toContain("EDITED AFTER REQUEST");
  });
});

describe("sections and voting", () => {
  test("extraction records the section count and findings cite clauses", async () => {
    client.script = null;
    const report = await uploadAndAudit("msa-multiple-failures.docx", "MSA");
    const liability = report.findings.find((f) => f.ruleTitle === "Liability is capped")!;
    expect(liability.evidence[0]).toMatchObject({ verified: true, location: "§8 Liability" });
    const log = await get<{ items: { payload: { sectionCount?: number } }[] }>(
      `/audit-log?streamId=${report.agreementId}&eventType=AgreementTextExtracted`,
    );
    expect(log.items[0]!.payload.sectionCount).toBe(13);
  });

  test("an unclear finding is re-asked twice and the majority wins", async () => {
    // First answer: unclear on the IP rule. Both votes: fail. Majority fail overturns it.
    client.script = (req, n) => {
      const out = fixtureResponder(req, n) as { findings: { ruleId: string; status: string; confidence: number }[] };
      const ip = req.context.rules.find((r) => r.slug === "ip-assignment");
      for (const f of out.findings) if (f.ruleId === ip?.id) f.status = n === 1 ? "unclear" : "fail";
      return out;
    };
    const report = await uploadAndAudit("employment-ambiguous-ip.md", "Employment");
    const ip = report.findings.find((f) => f.ruleTitle === "IP created for the Company is assigned to it")!;
    expect(ip.status).toBe("fail");
    expect((ip as { votes?: string[] }).votes).toEqual(["unclear", "fail", "fail"]);
    expect(report.verdict).toBe("fail");
    expect(report.modelCalls).toBe(3);
    const voted = report.timeline.find((t) => t.eventType === "AuditRunFindingsVoted")!;
    expect(voted.summary).toContain("1 changed by majority vote");
    const purposes = report.timeline
      .filter((t) => t.eventType === "AuditRunClaudeCalled")
      .map((t) => (t.payload as { purpose?: string }).purpose);
    expect(purposes).toEqual(["audit", "vote", "vote"]);
    const prompts = await get<PromptAttemptDto[]>(`/audits/${report.id}/prompts`);
    expect(prompts[1]!.prompt).toContain("against these 1 rules");
  });

  test("certain findings trigger no extra calls", async () => {
    client.script = null;
    const report = await uploadAndAudit("saas-auto-renewal.pdf", "SaaS");
    expect(report.modelCalls).toBe(1);
    expect(report.timeline.map((t) => t.eventType)).not.toContain("AuditRunFindingsVoted");
  });

  test("voting mode all re-checks every rule", async () => {
    client.script = null;
    voting.mode = "all";
    const report = await uploadAndAudit("nda-compliant.pdf", "NDA");
    voting.mode = "uncertain";
    expect(report.modelCalls).toBe(3);
    expect(report.findings.every((f) => (f as { votes?: string[] }).votes?.length === 3)).toBe(true);
  });
});

describe("upload validation", () => {
  test("a renamed executable is rejected with 415", async () => {
    const res = await upload("contract.pdf", "NDA", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]));
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("missing agreement type is a 422 on the field", async () => {
    const res = await upload("nda-compliant.pdf", "Lease");
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details[0]?.path).toBe("agreementType");
  });

  test("viewers cannot upload", async () => {
    const viewer = await h.login("viewer@example.com");
    expect((await upload("nda-compliant.pdf", "NDA", undefined, viewer)).status).toBe(403);
  });

  test("auditing before extraction finishes is a 409", async () => {
    const a = (await (await upload("nda-compliant.pdf", "NDA")).json()) as AgreementDto;
    const res = await h.call("POST", `/agreements/${a.id}/audits`, { cookie: auditor, body: {} });
    expect(res.status).toBe(409);
    await worker.drain();
  });

  test("downloading the original file records an event", async () => {
    const a = (await (await upload("msa-medium-issues.txt", "MSA")).json()) as AgreementDto;
    const res = await h.call("GET", `/agreements/${a.id}/file`, { cookie: auditor });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("MASTER SERVICES AGREEMENT");
    const log = await get<{ items: { eventType: string }[] }>(`/audit-log?streamId=${a.id}&includeReads=true`);
    expect(log.items.map((i) => i.eventType)).toContain("AgreementDownloaded");
    await worker.drain();
  });

  test("previewing shows the original inline, with scripts blocked, and records an event", async () => {
    const pdf = (await (await upload("nda-compliant.pdf", "NDA")).json()) as AgreementDto;
    const docx = (await (await upload("msa-multiple-failures.docx", "MSA")).json()) as AgreementDto;
    const txt = (await (await upload("msa-medium-issues.txt", "MSA")).json()) as AgreementDto;

    const pdfRes = await h.call("GET", `/agreements/${pdf.id}/preview`, { cookie: auditor });
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-disposition")).toStartWith("inline;");

    const docxRes = await h.call("GET", `/agreements/${docx.id}/preview`, { cookie: auditor });
    expect(docxRes.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(docxRes.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await docxRes.text();
    expect(html).toContain("<h2>");
    expect(html).not.toContain("<script");

    const txtRes = await h.call("GET", `/agreements/${txt.id}/preview`, { cookie: auditor });
    expect(txtRes.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await txtRes.text()).toContain("MASTER SERVICES AGREEMENT");

    const log = await get<{ items: { eventType: string }[] }>(`/audit-log?streamId=${docx.id}&includeReads=true`);
    expect(log.items.map((i) => i.eventType)).toContain("AgreementPreviewed");
    await worker.drain();
  });
});
