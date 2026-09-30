import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgreementDto, AgreementPageDto } from "@app/contracts";
import { environmentAuditModel, StubAuditClient } from "@app/llm";
import { seedAllRules } from "@app/seeds/catalog";
import { fixtureResponder } from "@app/seeds/stub";
import { extractTextHandler, runAuditHandler } from "@app/worker/handlers";
import { Worker } from "@app/worker/worker";
import { createHarness } from "./harness.ts";

/** Search, filters and paging on GET /agreements, against agreements that went through the real pipeline. */
let h: Awaited<ReturnType<typeof createHarness>>;
let viewer: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  h = await createHarness();
  await seedAllRules(h.t);
  const auditor = await h.login("auditor@example.com");
  viewer = await h.login("viewer@example.com");
  const worker = new Worker({
    database: h.t,
    workerId: "list-worker",
    handlers: {
      extract_text: extractTextHandler(h.storage, async () => environmentAuditModel({})),
      run_audit: runAuditHandler(async () => new StubAuditClient(fixtureResponder)),
    },
  });
  const upload = async (file: string, type: string) => {
    const a = (await (await h.upload(file, type, auditor)).json()) as AgreementDto;
    ids[file] = a.id;
  };
  await upload("nda-compliant.pdf", "NDA"); // pass
  await upload("msa-multiple-failures.docx", "MSA"); // fail
  await upload("employment-ambiguous-ip.md", "Employment"); // warn
  await upload("nda-pl-compliant.md", "NDA"); // pass, Polish
  await upload("scanned-no-text-layer.pdf", "NDA"); // extraction failed
  await worker.drain();
  // Stands in for an agreement whose text is ready but that nobody has audited yet.
  await h.t
    .sql`update agreements set latest_run_id = null, latest_run_status = null, latest_verdict = null where id = ${ids["employment-ambiguous-ip.md"]!}`;
});
afterAll(async () => {
  await h.close();
});

const list = async (qs = "") => {
  const res = await h.call("GET", `/agreements${qs}`, { cookie: viewer });
  expect(res.status).toBe(200);
  return (await res.json()) as AgreementPageDto;
};
const files = (p: AgreementPageDto) => p.items.map((a) => a.fileName).sort();

test("without parameters: first page, newest first, with the total", async () => {
  const p = await list();
  expect(p).toMatchObject({ page: 1, pageSize: 20, total: 5, anyInProgress: false });
  expect(p.items[0]!.fileName).toBe("scanned-no-text-layer.pdf");
});

test("pages split the list without overlap", async () => {
  const [a, b, c] = await Promise.all([list("?pageSize=2&page=1"), list("?pageSize=2&page=2"), list("?pageSize=2&page=3")]);
  expect([a.items.length, b.items.length, c.items.length]).toEqual([2, 2, 1]);
  expect(new Set([...a.items, ...b.items, ...c.items].map((x) => x.id)).size).toBe(5);
  expect(c.total).toBe(5);
  expect((await list("?pageSize=2&page=9")).items).toEqual([]);
});

describe("search", () => {
  test("matches the title or the file name, ignoring case", async () => {
    expect(files(await list("?q=NDA"))).toEqual(["nda-compliant.pdf", "nda-pl-compliant.md"]);
    expect(files(await list("?q=MULTIPLE"))).toEqual(["msa-multiple-failures.docx"]);
  });

  test("treats % and _ literally", async () => {
    expect((await list("?q=%25")).total).toBe(0);
    expect((await list("?q=_")).total).toBe(0);
  });
});

describe("filters", () => {
  test.each([
    ["pass", ["nda-compliant.pdf", "nda-pl-compliant.md"]],
    ["fail", ["msa-multiple-failures.docx"]],
    ["not_audited", ["employment-ambiguous-ip.md"]],
    ["extraction_failed", ["scanned-no-text-layer.pdf"]],
    ["warn", []],
    ["in_progress", []],
  ])("status=%s", async (status, expected) => {
    expect(files(await list(`?status=${status}`))).toEqual(expected);
  });

  test("type and language combine with search", async () => {
    expect(files(await list("?type=NDA&language=pl"))).toEqual(["nda-pl-compliant.md"]);
    expect(files(await list("?type=NDA&status=pass&q=compliant"))).toEqual(["nda-compliant.pdf", "nda-pl-compliant.md"]);
    expect((await list("?type=MSA&status=pass")).total).toBe(0);
  });
});

test("invalid parameters are rejected", async () => {
  for (const qs of ["?status=great", "?page=0", "?pageSize=500", "?type=Lease"]) {
    expect((await h.call("GET", `/agreements${qs}`, { cookie: viewer })).status).toBe(422);
  }
});
