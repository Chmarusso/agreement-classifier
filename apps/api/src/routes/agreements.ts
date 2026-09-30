import {
  type AgreementDetailDto,
  AgreementListQuery,
  type AgreementPageDto,
  type AgreementStatusFilter,
  type AgreementTextDto,
  AgreementTypeDto,
  RequestAuditBody,
} from "@app/contracts";
import { AgreementAggregate, agreements, agreementTexts, auditRuns, executeCommand, requestAudit, rules } from "@app/db";
import { AppError, rulesApplyingTo, sha256Hex } from "@app/domain";
import { detectFormat, docxPreviewHtml, ExtractionError, MAX_UPLOAD_BYTES, sectionLabel, segmentSections } from "@app/extraction";
import { and, desc, eq, ilike, inArray, isNull, notInArray, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { currentAuditModel, seesCosts } from "../lib/audit-model.ts";
import { requireRole, requireUser } from "../lib/auth.ts";
import { type Deps, type Env, metaFrom } from "../lib/context.ts";
import { toAgreementDto, toRunSummaryDto } from "../lib/dto.ts";
import { parseJson, parseQuery, parseTextView, parseUuidParam } from "../lib/validate.ts";
import { recordView } from "../lib/views.ts";

/** Same order of precedence as the list's status label: extraction first, then the latest audit. */
function statusCondition(status: AgreementStatusFilter): SQL | undefined {
  const extracted = eq(agreements.extractionStatus, "extracted");
  switch (status) {
    case "extracting":
      return eq(agreements.extractionStatus, "pending");
    case "extraction_failed":
      return eq(agreements.extractionStatus, "failed");
    case "in_progress":
      return and(extracted, inArray(agreements.latestRunStatus, ["requested", "running"]));
    case "pass":
    case "warn":
    case "fail":
      return and(extracted, notInArray(agreements.latestRunStatus, ["requested", "running"]), eq(agreements.latestVerdict, status));
    case "audit_failed":
      return and(extracted, eq(agreements.latestRunStatus, "failed"), isNull(agreements.latestVerdict));
    case "not_audited":
      return and(extracted, isNull(agreements.latestRunStatus));
  }
}

export function agreementFilters(q: AgreementListQuery): (SQL | undefined)[] {
  const like = q.q ? `%${q.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  return [
    like ? or(ilike(agreements.title, like), ilike(agreements.fileName, like)) : undefined,
    q.status ? statusCondition(q.status) : undefined,
    q.type ? eq(agreements.agreementType, q.type) : undefined,
    q.language ? eq(agreements.language, q.language) : undefined,
  ];
}

export function agreementRoutes(deps: Deps) {
  const { db } = deps.database;
  const load = async (id: string) => {
    const [a] = await db.select().from(agreements).where(eq(agreements.id, id));
    if (!a) throw new AppError("NOT_FOUND", "Agreement not found.");
    return a;
  };
  const activeRulesFor = async (type: AgreementTypeDto, language: "pl" | "en" | null) =>
    rulesApplyingTo(await db.select().from(rules).where(eq(rules.status, "active")), type, language);

  return new Hono<Env>()
    .use(requireUser)
    .get("/", async (c) => {
      const query = parseQuery(c, AgreementListQuery);
      const where = and(...agreementFilters(query));
      const inProgress = or(eq(agreements.extractionStatus, "pending"), inArray(agreements.latestRunStatus, ["requested", "running"]));
      const [rows, [counts]] = await Promise.all([
        db
          .select()
          .from(agreements)
          .where(where)
          .orderBy(desc(agreements.createdAt), desc(agreements.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db
          .select({
            total: sql<number>`(count(*) filter (where ${where ?? sql`true`}))::int`,
            inProgress: sql<number>`(count(*) filter (where ${inProgress}))::int`,
          })
          .from(agreements),
      ]);
      const showCosts = seesCosts(c);
      const body: AgreementPageDto = {
        items: rows.map((a) => toAgreementDto(a, showCosts)),
        total: counts?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        anyInProgress: (counts?.inProgress ?? 0) > 0,
      };
      return c.json(body);
    })
    .post(
      "/",
      requireRole("auditor"),
      bodyLimit({
        maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
        onError: () => {
          throw new AppError("PAYLOAD_TOO_LARGE", "The file is larger than 20 MB.");
        },
      }),
      async (c) => {
        const form = await c.req.parseBody().catch(() => {
          throw new AppError("VALIDATION_FAILED", "Send the file as multipart/form-data.");
        });
        const file = form.file;
        if (!(file instanceof File) || file.size === 0) {
          throw new AppError("VALIDATION_FAILED", "Choose a file to upload.", [{ path: "file", message: "Required" }]);
        }
        const type = AgreementTypeDto.safeParse(form.agreementType);
        if (!type.success)
          throw new AppError("VALIDATION_FAILED", "Choose the agreement type.", [{ path: "agreementType", message: "Required" }]);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let detected: ReturnType<typeof detectFormat>;
        try {
          detected = detectFormat(bytes, file.name);
        } catch (err) {
          if (err instanceof ExtractionError)
            throw new AppError("UNSUPPORTED_MEDIA_TYPE", err.message, [{ path: "file", message: err.message }]);
          throw err;
        }
        const id = crypto.randomUUID();
        const sha256 = sha256Hex(bytes);
        const storageKey = deps.storage.keyFor(id, sha256, detected.format);
        await deps.storage.put(storageKey, bytes);
        const rawTitle = typeof form.title === "string" ? form.title.trim() : "";
        const title = (rawTitle || file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")).slice(0, 200);
        await executeCommand(
          db,
          AgreementAggregate,
          id,
          {
            type: "UploadAgreement",
            fileName: file.name.slice(0, 255),
            mimeType: detected.mimeType,
            format: detected.format,
            sizeBytes: bytes.length,
            storageKey,
            sha256,
            title,
            agreementType: type.data,
          },
          metaFrom(c),
        );
        return c.json(toAgreementDto(await load(id), seesCosts(c)), 201);
      },
    )
    .get("/:id", async (c) => {
      const id = parseUuidParam(c, "id");
      await load(id);
      await recordView(deps, c, AgreementAggregate, id, { type: "ViewAgreement" }, "AgreementViewed");
      const a = await load(id);
      const showCosts = seesCosts(c);
      const [runs, applicable] = await Promise.all([
        db.select().from(auditRuns).where(eq(auditRuns.agreementId, id)).orderBy(desc(auditRuns.requestedAt)),
        activeRulesFor(a.agreementType, a.language),
      ]);
      const body: AgreementDetailDto = {
        ...toAgreementDto(a, showCosts),
        runs: runs.map((r) => toRunSummaryDto(r, a.title, showCosts)),
        applicableRuleCount: applicable.length,
      };
      return c.json(body);
    })
    .get("/:id/text", async (c) => {
      const id = parseUuidParam(c, "id");
      const view = parseTextView(c.req.query("view"));
      const [t] = await db.select().from(agreementTexts).where(eq(agreementTexts.agreementId, id));
      if (!t) throw new AppError("NOT_FOUND", "No extracted text for this agreement yet.");
      if (view === "anonymized" && t.anonymizedText === null)
        throw new AppError("NOT_FOUND", "This agreement was not anonymized; the model receives the original text.");
      const text = view === "anonymized" ? t.anonymizedText! : t.text;
      const body: AgreementTextDto = {
        view,
        text,
        extractor: t.extractor,
        language: t.language,
        sections: segmentSections(text).map((s) => ({ ...s, label: sectionLabel(s) })),
        anonymization: t.anonymization ? { engine: t.anonymization.engine, entities: t.anonymization.entities } : null,
      };
      return c.json(body);
    })
    .get("/:id/file", async (c) => {
      const id = parseUuidParam(c, "id");
      const a = await load(id);
      const bytes = await deps.storage.get(a.storageKey);
      await recordView(deps, c, AgreementAggregate, id, { type: "DownloadAgreement" }, "AgreementDownloaded");
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
        headers: {
          "content-type": a.mimeType,
          "content-disposition": `attachment; filename="${a.fileName.replaceAll('"', "")}"`,
          "x-request-id": c.get("requestId"),
        },
      });
    })
    .get("/:id/preview", async (c) => {
      const id = parseUuidParam(c, "id");
      const a = await load(id);
      const bytes = await deps.storage.get(a.storageKey);
      await recordView(deps, c, AgreementAggregate, id, { type: "PreviewAgreement" }, "AgreementPreviewed");
      // The browser shows the file itself: PDF in its viewer, text as text, DOCX converted to plain HTML.
      const headers: Record<string, string> = {
        "content-disposition": `inline; filename="${a.fileName.replaceAll('"', "")}"`,
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
        "x-content-type-options": "nosniff",
        "x-request-id": c.get("requestId"),
      };
      if (a.format === "docx") {
        return new Response(await docxPreviewHtml(bytes, a.title), { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
      }
      const type = a.format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
      return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { headers: { ...headers, "content-type": type } });
    })
    .post("/:id/audits", requireRole("auditor"), async (c) => {
      const id = parseUuidParam(c, "id");
      const a = await load(id);
      const body = await parseJson(c, RequestAuditBody);
      if (a.extractionStatus !== "extracted") {
        throw new AppError(
          "CONFLICT",
          a.extractionStatus === "failed"
            ? "Text extraction failed, so this agreement cannot be audited."
            : "Text extraction is still running. Try again in a moment.",
        );
      }
      const { resolved } = await currentAuditModel(deps);
      const { runId } = await requestAudit(db, {
        agreementId: id,
        agreementType: a.agreementType,
        agreementLanguage: a.language,
        ruleIds: body.ruleIds,
        model: { label: resolved.label, config: { provider: resolved.provider, model: resolved.model, reasoning: resolved.reasoning } },
        meta: metaFrom(c),
      });
      const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, runId));
      return c.json(toRunSummaryDto(run!, a.title, seesCosts(c)), 201);
    });
}
