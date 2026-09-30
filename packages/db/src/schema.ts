import type { AgreementLanguage, AgreementType } from "@app/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Append-only event store. The single source of truth. */
export const events = pgTable(
  "events",
  {
    globalPosition: bigserial("global_position", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique("events_event_id_uq"),
    streamType: text("stream_type").notNull(),
    streamId: uuid("stream_id").notNull(),
    streamVersion: integer("stream_version").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata").notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_stream_version_uq").on(t.streamType, t.streamId, t.streamVersion),
    index("events_stream_idx").on(t.streamType, t.streamId),
    index("events_type_time_idx").on(t.eventType, t.occurredAt),
    index("events_time_idx").on(t.occurredAt),
    index("events_metadata_gin").using("gin", t.metadata),
  ],
);

/** Transactional outbox and work queue for the worker. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    sourceEventId: uuid("source_event_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_pending_idx").on(t.runAfter).where(sql`status = 'pending'`),
    index("jobs_running_idx").on(t.lockedUntil).where(sql`status = 'running'`),
  ],
);

export const projectionCheckpoints = pgTable("projection_checkpoints", {
  name: text("name").primaryKey(),
  lastPosition: bigint("last_position", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Operational heartbeat, not event-sourced: it changes every few seconds. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  hostname: text("hostname").notNull(),
  startedAt: ts("started_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull(),
});

// ---- Projections (rebuildable from events) ----

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["admin", "auditor", "viewer"] }).notNull(),
    status: text("status", { enum: ["active", "deactivated"] }).notNull(),
    version: integer("version").notNull(),
    lastLoginAt: ts("last_login_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    globalPosition: bigint("global_position", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    actorType: text("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    streamType: text("stream_type").notNull(),
    streamId: uuid("stream_id").notNull(),
    entityLabel: text("entity_label"),
    summary: text("summary").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata").notNull(),
  },
  (t) => [
    index("audit_log_time_idx").on(t.occurredAt),
    index("audit_log_type_idx").on(t.eventType),
    index("audit_log_stream_idx").on(t.streamType, t.streamId),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
    category: text("category").notNull(),
    appliesTo: jsonb("applies_to").$type<AgreementType[]>().notNull(),
    languages: jsonb("languages").$type<AgreementLanguage[]>().notNull().default([]),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    version: integer("version").notNull(),
    contentVersion: integer("content_version").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("rules_slug_uq").on(t.slug)],
);

/** One row per content version, so audit runs can pin the exact rule text they used. */
export const ruleVersions = pgTable(
  "rule_versions",
  {
    ruleId: uuid("rule_id").notNull(),
    contentVersion: integer("content_version").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
    category: text("category").notNull(),
    appliesTo: jsonb("applies_to").$type<AgreementType[]>().notNull(),
    languages: jsonb("languages").$type<AgreementLanguage[]>().notNull().default([]),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.contentVersion] })],
);

export const agreements = pgTable(
  "agreements",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    format: text("format", { enum: ["pdf", "docx", "txt", "md"] }).notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    agreementType: text("agreement_type", { enum: ["NDA", "MSA", "SaaS", "Employment", "Other"] }).notNull(),
    extractionStatus: text("extraction_status", { enum: ["pending", "extracted", "failed"] }).notNull(),
    extractionError: text("extraction_error"),
    charCount: integer("char_count"),
    pageCount: integer("page_count"),
    language: text("language", { enum: ["pl", "en"] }),
    /** Null until the text is anonymized; the number of personal data items replaced. */
    anonymizedEntityCount: integer("anonymized_entity_count"),
    uploadedBy: uuid("uploaded_by"),
    latestRunId: uuid("latest_run_id"),
    latestRunStatus: text("latest_run_status"),
    latestVerdict: text("latest_verdict"),
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    version: integer("version").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("agreements_created_idx").on(t.createdAt)],
);

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: uuid("id").primaryKey(),
    agreementId: uuid("agreement_id").notNull(),
    status: text("status", { enum: ["requested", "running", "completed", "failed", "cancelled"] }).notNull(),
    model: text("model").notNull(),
    ruleSnapshot: jsonb("rule_snapshot").$type<{ ruleId: string; version: number }[]>().notNull(),
    verdict: text("verdict", { enum: ["pass", "warn", "fail"] }),
    summary: text("summary"),
    findings: jsonb("findings"),
    agreementMetadata: jsonb("agreement_metadata"),
    failureReason: text("failure_reason"),
    modelCalls: integer("model_calls").notNull().default(0),
    rejectedOutputs: integer("rejected_outputs").notNull().default(0),
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    modelDurationMs: integer("model_duration_ms").notNull().default(0),
    requestedBy: uuid("requested_by"),
    requestedAt: ts("requested_at").notNull(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    version: integer("version").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("audit_runs_agreement_idx").on(t.agreementId), index("audit_runs_requested_idx").on(t.requestedAt)],
);

/** Application settings decided by admins, one row per key. Rebuilt from System events. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  version: integer("version").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ---- Content tables: written next to events, never truncated by a rebuild ----

/** Extracted text. The event carries only its hash, so events stay small. */
export const agreementTexts = pgTable("agreement_texts", {
  agreementId: uuid("agreement_id").primaryKey(),
  text: text("text").notNull(),
  textSha256: text("text_sha256").notNull(),
  extractor: text("extractor").notNull(),
  language: text("language", { enum: ["pl", "en"] }),
  /** The text sent to the model when anonymization is on. Null when it is off or not done yet. */
  anonymizedText: text("anonymized_text"),
  /** Placeholder to value mapping; never enters a prompt. */
  anonymization: jsonb("anonymization").$type<StoredAnonymization>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface StoredAnonymization {
  engine: string;
  language: "pl" | "en";
  entities: { placeholder: string; label: string; value: string; count: number; variants: string[] }[];
}

/** Exact prompt and raw model response per attempt, for reproducing any audit. */
export const auditRunPrompts = pgTable(
  "audit_run_prompts",
  {
    runId: uuid("run_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    model: text("model").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    prompt: text("prompt").notNull(),
    promptSha256: text("prompt_sha256").notNull(),
    rawResponse: jsonb("raw_response"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.attemptNo] })],
);

/** Tables rebuilt from the event stream by `db:rebuild`. Order matters: audit_log reads the others. */
export const projectionTables = [
  "users",
  "sessions",
  "rules",
  "rule_versions",
  "agreements",
  "audit_runs",
  "audit_log",
  "app_settings",
] as const;
