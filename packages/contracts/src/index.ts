import { z } from "zod";

// Kept free of server imports so the web bundle can use it.

export const RoleDto = z.enum(["admin", "auditor", "viewer"]);
export type RoleDto = z.infer<typeof RoleDto>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).default([]),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// ---- Auth ----
export const OtpRequestBody = z.object({ email: z.string().trim().toLowerCase().email() });
export const OtpVerifyBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export interface OtpRequestResponse {
  status: "sent";
  /** Present only when the server accepts a fixed development code. */
  devCodeHint: string | null;
}

export interface MeDto {
  id: string;
  email: string;
  displayName: string;
  role: RoleDto;
}

// ---- Users ----
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: RoleDto;
  status: "active" | "deactivated";
  version: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export const CreateUserBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1, "Name is required").max(120),
  role: RoleDto,
});
export type CreateUserBody = z.infer<typeof CreateUserBody>;

export const ChangeRoleBody = z.object({ role: RoleDto, version: z.number().int().min(1) });
export type ChangeRoleBody = z.infer<typeof ChangeRoleBody>;

export const DeactivateUserBody = z.object({
  reason: z.string().trim().max(500).nullable().default(null),
  version: z.number().int().min(1),
});
export type DeactivateUserBody = z.infer<typeof DeactivateUserBody>;

export const ReactivateUserBody = z.object({ version: z.number().int().min(1) });

// ---- Audit log ----
export const AuditLogQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  eventType: z.string().optional(),
  streamType: z.string().optional(),
  streamId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  includeReads: z.enum(["true", "false"]).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export interface AuditLogEntryDto {
  globalPosition: number;
  eventId: string;
  occurredAt: string;
  actorId: string | null;
  actorLabel: string;
  actorType: string;
  eventType: string;
  streamType: string;
  streamId: string;
  entityLabel: string | null;
  summary: string;
  isRead: boolean;
  payload: unknown;
  metadata: unknown;
}

export interface AuditLogPage {
  items: AuditLogEntryDto[];
  nextCursor: number | null;
}

export interface AuditActorDto {
  id: string;
  label: string;
}

export interface EventTypesDto {
  eventTypes: { type: string; streamType: string }[];
  streamTypes: string[];
}

// ---- Rules ----
export const agreementTypesDto = ["NDA", "MSA", "SaaS", "Employment", "Other"] as const;
export const AgreementTypeDto = z.enum(agreementTypesDto);
export type AgreementTypeDto = z.infer<typeof AgreementTypeDto>;
export const SeverityDto = z.enum(["critical", "high", "medium", "low"]);
export type SeverityDto = z.infer<typeof SeverityDto>;

export const LanguageDto = z.enum(["pl", "en"]);
export type LanguageDto = z.infer<typeof LanguageDto>;

export const RuleBody = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(160),
  description: z.string().trim().min(10, "Describe the requirement in at least 10 characters").max(4000),
  severity: SeverityDto,
  category: z.string().trim().min(1, "Category is required").max(80),
  appliesTo: z.array(AgreementTypeDto).default([]),
  /** Empty means Polish and English agreements alike. */
  languages: z.array(LanguageDto).default([]),
});
export type RuleBody = z.infer<typeof RuleBody>;
export const UpdateRuleBody = RuleBody.extend({ version: z.number().int().min(1) });
export type UpdateRuleBody = z.infer<typeof UpdateRuleBody>;
export const RuleStatusBody = z.object({ version: z.number().int().min(1), reason: z.string().trim().max(500).nullable().default(null) });

export interface RuleDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  severity: SeverityDto;
  category: string;
  appliesTo: AgreementTypeDto[];
  languages: LanguageDto[];
  status: "active" | "archived";
  version: number;
  contentVersion: number;
  updatedAt: string;
}

export interface RuleVersionDto {
  contentVersion: number;
  title: string;
  description: string;
  severity: SeverityDto;
  category: string;
  appliesTo: AgreementTypeDto[];
  languages: LanguageDto[];
  createdAt: string;
}

export interface RuleDetailDto extends RuleDto {
  versions: RuleVersionDto[];
}

// ---- Agreements and audits ----
export type VerdictDto = "pass" | "warn" | "fail";
export type RunStatusDto = "requested" | "running" | "completed" | "failed" | "cancelled";
export type FindingStatusDto = "pass" | "fail" | "partial" | "not_applicable" | "unclear";

export interface AgreementDto {
  id: string;
  title: string;
  fileName: string;
  format: "pdf" | "docx" | "txt" | "md";
  sizeBytes: number;
  agreementType: AgreementTypeDto;
  extractionStatus: "pending" | "extracted" | "failed";
  extractionError: string | null;
  charCount: number | null;
  pageCount: number | null;
  language: "pl" | "en" | null;
  /** Null when not anonymized; otherwise the number of personal data items replaced before any model call. */
  anonymizedEntityCount: number | null;
  latestRunId: string | null;
  latestRunStatus: RunStatusDto | null;
  latestVerdict: VerdictDto | null;
  /** Admins only; absent for other roles. */
  totalCostUsd?: number;
  version: number;
  createdAt: string;
}

export interface AuditRunSummaryDto {
  id: string;
  agreementId: string;
  agreementTitle: string;
  status: RunStatusDto;
  verdict: VerdictDto | null;
  ruleCount: number;
  modelCalls: number;
  rejectedOutputs: number;
  failureReason: string | null;
  /** Model and spend fields are for admins only; absent for other roles. */
  model?: string;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelDurationMs?: number;
  requestedAt: string;
  finishedAt: string | null;
  version: number;
}

export interface FindingDto {
  ruleId: string;
  ruleVersion: number;
  ruleTitle: string;
  severity: SeverityDto;
  status: FindingStatusDto;
  confidence: number;
  explanation: string;
  evidence: { quote: string; location: string | null; sectionId?: string | null; citedSectionId?: string | null; verified: boolean }[];
  recommendation: string | null;
  /** Statuses from majority voting; the first is the original answer. */
  votes?: FindingStatusDto[];
}

export type TextViewDto = "original" | "anonymized";

export interface AnonymizedEntityDto {
  placeholder: string;
  label: string;
  value: string;
  count: number;
  variants: string[];
}

export interface AgreementTextDto {
  /** Which text this is. "anonymized" is exactly what the model receives. */
  view: TextViewDto;
  text: string;
  extractor: string;
  language: "pl" | "en" | null;
  sections: { id: string; number: string | null; heading: string | null; label: string; text: string }[];
  /** Null when the agreement was not anonymized. */
  anonymization: { engine: string; entities: AnonymizedEntityDto[] } | null;
}

export interface AuditRunDetailDto extends AuditRunSummaryDto {
  /** "original" puts personal data back into quotes and explanations; "anonymized" shows the model's own words. */
  view: TextViewDto;
  /** The model saw placeholders instead of personal data. */
  anonymized: boolean;
  summary: string | null;
  findings: FindingDto[];
  agreementMetadata: { title: string | null; parties: string[]; effectiveDate: string | null; governingLaw: string | null } | null;
  agreement: AgreementDto;
  timeline: AuditLogEntryDto[];
}

/** One status per agreement, as the list shows it: extraction problems first, then the latest audit. */
export const agreementStatusFilters = [
  "pass",
  "warn",
  "fail",
  "not_audited",
  "in_progress",
  "audit_failed",
  "extracting",
  "extraction_failed",
] as const;
export const AgreementStatusFilter = z.enum(agreementStatusFilters);
export type AgreementStatusFilter = z.infer<typeof AgreementStatusFilter>;

export const AgreementListQuery = z.object({
  /** Matches the title or the file name, ignoring case. */
  q: z.string().trim().max(200).optional(),
  status: AgreementStatusFilter.optional(),
  type: AgreementTypeDto.optional(),
  language: LanguageDto.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AgreementListQuery = z.infer<typeof AgreementListQuery>;

export interface AgreementPageDto {
  items: AgreementDto[];
  total: number;
  page: number;
  pageSize: number;
  /** True while any agreement anywhere is extracting or being audited, so the list keeps refreshing. */
  anyInProgress: boolean;
}

export interface AgreementDetailDto extends AgreementDto {
  runs: AuditRunSummaryDto[];
  applicableRuleCount: number;
}

export interface PromptAttemptDto {
  attemptNo: number;
  model: string;
  systemPrompt: string;
  prompt: string;
  rawResponse: unknown;
  createdAt: string;
}

export const RequestAuditBody = z.object({ ruleIds: z.array(z.string().uuid()).min(1).optional() });
export const RunActionBody = z.object({ version: z.number().int().min(1) });

export interface VerdictCountsDto {
  pass: number;
  warn: number;
  fail: number;
  failedRuns: number;
  inProgress: number;
}

export interface CostsDto {
  currency: "USD";
  total: { costUsd: number; runs: number; inputTokens: number; outputTokens: number };
  thisMonth: { costUsd: number; runs: number };
  byModel: { model: string; costUsd: number; runs: number; avgCostUsd: number }[];
  byDay: { day: string; costUsd: number; runs: number }[];
}

// ---- Settings ----

export const AnonymizationConfigDto = z.object({
  disabledLabels: z.array(z.string()),
  personCues: z.boolean(),
  propagate: z.boolean(),
  inflection: z.boolean(),
  ner: z.boolean(),
  nerModels: z.object({ pl: z.string().min(1).max(100).nullable(), en: z.string().min(1).max(100).nullable() }),
  keep: z.array(z.string().trim().min(2, "At least 2 characters").max(200)).max(50, "At most 50 terms"),
});
export type AnonymizationConfigDto = z.infer<typeof AnonymizationConfigDto>;
export const AnonymizationSettingsBody = AnonymizationConfigDto.extend({ version: z.number().int().min(0) });
export const ResetAnonymizationBody = z.object({ version: z.number().int().min(0) });
export const AnonymizationPreviewBody = z.object({
  text: z.string().min(1, "Paste some text").max(20_000, "At most 20,000 characters"),
  config: AnonymizationConfigDto,
});

export interface AnonymizationServiceDto {
  /** False when ANONYMIZER_URL is not set or the service does not answer. */
  reachable: boolean;
  url: string | null;
  error: string | null;
  engine: string | null;
  /** Installed NER models per language; empty when the service runs rules only. */
  nerModels: Record<string, string[]>;
  nerDefaultModels: Record<string, string>;
}

export interface AnonymizationSettingsDto {
  config: AnonymizationConfigDto;
  /** True when no admin has saved settings: the defaults apply. */
  isDefault: boolean;
  version: number;
  labels: string[];
  service: AnonymizationServiceDto;
}

export interface AnonymizationPreviewDto {
  text: string;
  language: "pl" | "en";
  engine: string;
  entities: AnonymizedEntityDto[];
}
export const LlmProviderDto = z.enum(["openrouter", "claude-cli", "claude-bridge", "stub"]);
export type LlmProviderDto = z.infer<typeof LlmProviderDto>;
export const ReasoningDto = z.enum(["off", "low", "provider-default"]);
export type ReasoningDto = z.infer<typeof ReasoningDto>;

export const AuditModelBody = z.object({
  provider: LlmProviderDto,
  model: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .default(null)
    .transform((m) => m || null),
  reasoning: ReasoningDto.nullable().default(null),
  version: z.number().int().min(0),
});
export type AuditModelBody = z.infer<typeof AuditModelBody>;
export const ResetAuditModelBody = z.object({ version: z.number().int().min(0) });

export interface ResolvedAuditModelDto {
  provider: LlmProviderDto;
  model: string;
  reasoning: ReasoningDto;
  label: string;
  source: "admin" | "environment";
}

export interface AuditModelSettingsDto {
  current: ResolvedAuditModelDto;
  environmentDefault: ResolvedAuditModelDto;
  providers: { id: LlmProviderDto; available: boolean; reason: string | null }[];
  /** Stream version for optimistic edits; 0 before the first change. */
  version: number;
}

// ---- System ----
export interface HealthDto {
  status: "ok" | "degraded";
  db: "ok" | "down";
  worker: { lastSeenAt: string | null; ageSeconds: number | null; status: "ok" | "stale" | "missing" };
}

export interface DashboardDto {
  users: { total: number; active: number };
  rules: { active: number };
  /** byLatestVerdict counts agreements by their latest audit, matching the agreements list filters. */
  agreements: { total: number; byLatestVerdict: { pass: number; warn: number; fail: number } };
  verdicts: VerdictCountsDto;
  events: { total: number; last24h: number };
  /** Admins only; empty for other roles. */
  recent: AuditLogEntryDto[];
}
