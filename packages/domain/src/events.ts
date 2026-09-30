import { z } from "zod";

export const roles = ["admin", "auditor", "viewer"] as const;
export const Role = z.enum(roles);
export type Role = z.infer<typeof Role>;

/** UserAuth holds login activity per user, so logins never conflict with profile edits on User. */
export const streamTypes = ["User", "UserAuth", "Rule", "Agreement", "AuditRun", "System"] as const;
export type StreamType = (typeof streamTypes)[number];

export const actorTypes = ["user", "worker", "system", "anonymous"] as const;
export type ActorType = (typeof actorTypes)[number];

export const EventMetadata = z.object({
  actorUserId: z.string().uuid().nullable(),
  actorType: z.enum(actorTypes),
  correlationId: z.string(),
  causationId: z.string().nullable().default(null),
  requestId: z.string().nullable().default(null),
  ip: z.string().nullable().default(null),
  userAgent: z.string().nullable().default(null),
});
export type EventMetadata = z.infer<typeof EventMetadata>;

const iso = z.string().datetime({ offset: true });

export const llmProviders = ["openrouter", "claude-cli", "claude-bridge", "stub"] as const;
export const LlmProvider = z.enum(llmProviders);
export type LlmProvider = z.infer<typeof LlmProvider>;
export const openRouterReasoningModes = ["off", "low", "provider-default"] as const;
export const OpenRouterReasoning = z.enum(openRouterReasoningModes);
export type OpenRouterReasoning = z.infer<typeof OpenRouterReasoning>;

/** What an admin chose as the audit model. `model` null means the provider's default. */
export const AuditModelConfig = z.object({
  provider: LlmProvider,
  model: z.string().trim().min(1).max(200).nullable(),
  reasoning: OpenRouterReasoning.nullable(),
});
export type AuditModelConfig = z.infer<typeof AuditModelConfig>;

export const agreementTypes = ["NDA", "MSA", "SaaS", "Employment", "Other"] as const;
export const AgreementType = z.enum(agreementTypes);
export type AgreementType = z.infer<typeof AgreementType>;

export const severities = ["critical", "high", "medium", "low"] as const;
export const Severity = z.enum(severities);
export type Severity = z.infer<typeof Severity>;

export const findingStatuses = ["pass", "fail", "partial", "not_applicable", "unclear"] as const;
export const FindingStatus = z.enum(findingStatuses);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const verdicts = ["pass", "warn", "fail"] as const;
export const Verdict = z.enum(verdicts);
export type Verdict = z.infer<typeof Verdict>;

export const agreementFormats = ["pdf", "docx", "txt", "md"] as const;
export const AgreementFormat = z.enum(agreementFormats);
export type AgreementFormat = z.infer<typeof AgreementFormat>;

export const agreementLanguages = ["pl", "en"] as const;
export const AgreementLanguage = z.enum(agreementLanguages);
export type AgreementLanguage = z.infer<typeof AgreementLanguage>;

/** Everything the anonymizer can replace. Keep in sync with apps/anonymizer/anonymizer/spans.py. */
export const anonymizationLabels = [
  "PESEL",
  "NIP",
  "REGON",
  "KRS",
  "ID_CARD",
  "LAND_REGISTER",
  "PASSPORT",
  "SSN",
  "NI_NUMBER",
  "VAT_ID",
  "COMPANY_NO",
  "IBAN",
  "BANK_ACCOUNT",
  "CARD",
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "PERSON",
  "ORG",
] as const;
export const AnonymizationLabel = z.enum(anonymizationLabels);
export type AnonymizationLabel = z.infer<typeof AnonymizationLabel>;

/** The admin's anonymization techniques. Labels are listed as disabled so types added later are on by default. */
export const AnonymizationConfig = z.object({
  disabledLabels: z.array(AnonymizationLabel),
  personCues: z.boolean(),
  propagate: z.boolean(),
  inflection: z.boolean(),
  ner: z.boolean(),
  /** spaCy model per language; null uses the service default. */
  nerModels: z.object({ pl: z.string().min(1).max(100).nullable(), en: z.string().min(1).max(100).nullable() }),
  /** Terms that are never replaced, such as the company's own name. */
  keep: z.array(z.string().trim().min(2).max(200)).max(50),
});
export type AnonymizationConfig = z.infer<typeof AnonymizationConfig>;

const RuleContent = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(4000),
  severity: Severity,
  category: z.string().min(1).max(80),
  appliesTo: z.array(AgreementType),
  /** Agreement languages the rule applies to; empty means every language. Absent in events written before languages existed. */
  languages: z.array(AgreementLanguage).default([]),
});
export type RuleContent = z.infer<typeof RuleContent>;

export const StoredFinding = z.object({
  ruleId: z.string().uuid(),
  ruleVersion: z.number().int(),
  ruleTitle: z.string(),
  severity: Severity,
  status: FindingStatus,
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  evidence: z.array(
    z.object({
      quote: z.string(),
      /** Human label of the section the quote was found in, e.g. "§4 Termination". */
      location: z.string().nullable(),
      /** Section id the quote belongs to; absent on runs recorded before sections existed. */
      sectionId: z.string().nullable().optional(),
      /** Section the model cited; differs from sectionId when the quote was found elsewhere. */
      citedSectionId: z.string().nullable().optional(),
      verified: z.boolean(),
    }),
  ),
  recommendation: z.string().nullable(),
  /** Statuses from majority voting, first one is the original answer. Absent when not voted. */
  votes: z.array(FindingStatus).optional(),
});
export type StoredFinding = z.infer<typeof StoredFinding>;

export const AgreementMetadata = z.object({
  title: z.string().nullable(),
  parties: z.array(z.string()),
  effectiveDate: z.string().nullable(),
  governingLaw: z.string().nullable(),
});
export type AgreementMetadata = z.infer<typeof AgreementMetadata>;

/**
 * Registry of every event the system can store. Each entry names the stream
 * type it belongs to and the payload schema, which is enforced on append and
 * on replay.
 */
export const eventRegistry = {
  UserRegistered: {
    stream: "User",
    payload: z.object({
      email: z.string().email(),
      displayName: z.string().min(1).max(120),
      role: Role,
      invitedBy: z.string().uuid().nullable(),
    }),
  },
  UserRoleChanged: {
    stream: "User",
    payload: z.object({ oldRole: Role, newRole: Role }),
  },
  UserDeactivated: {
    stream: "User",
    payload: z.object({ reason: z.string().max(500).nullable() }),
  },
  UserReactivated: {
    stream: "User",
    payload: z.object({}),
  },
  OtpRequested: {
    stream: "UserAuth",
    payload: z.object({
      codeHash: z.string().length(64),
      expiresAt: iso,
      deliveryChannel: z.enum(["console", "email"]),
    }),
  },
  OtpVerified: {
    stream: "UserAuth",
    payload: z.object({
      sessionId: z.string().uuid(),
      tokenHash: z.string().length(64),
      sessionExpiresAt: iso,
      usedDevCode: z.boolean(),
    }),
  },
  OtpVerificationFailed: {
    stream: "UserAuth",
    payload: z.object({
      reason: z.enum(["expired", "mismatch", "locked", "no_code", "inactive"]),
      attemptNo: z.number().int().min(0),
      lockedUntil: iso.nullable(),
    }),
  },
  UserLoggedOut: {
    stream: "UserAuth",
    payload: z.object({ sessionId: z.string().uuid() }),
  },
  RuleCreated: {
    stream: "Rule",
    payload: RuleContent.extend({ slug: z.string().regex(/^[a-z0-9-]+$/) }),
  },
  RuleUpdated: {
    stream: "Rule",
    payload: RuleContent.extend({ changedFields: z.array(z.string()) }),
  },
  RuleArchived: { stream: "Rule", payload: z.object({ reason: z.string().max(500).nullable() }) },
  RuleRestored: { stream: "Rule", payload: z.object({}) },
  RuleViewed: { stream: "Rule", payload: z.object({}) },
  AgreementUploaded: {
    stream: "Agreement",
    payload: z.object({
      fileName: z.string().min(1).max(255),
      mimeType: z.string(),
      format: AgreementFormat,
      sizeBytes: z.number().int().positive(),
      storageKey: z.string(),
      sha256: z.string().length(64),
      title: z.string().min(1).max(200),
      agreementType: AgreementType,
    }),
  },
  AgreementTextExtracted: {
    stream: "Agreement",
    payload: z.object({
      extractor: z.string(),
      charCount: z.number().int(),
      pageCount: z.number().int().nullable(),
      textSha256: z.string().length(64),
      sectionCount: z.number().int().optional(),
      language: AgreementLanguage.optional(),
    }),
  },
  AgreementTextExtractionFailed: {
    stream: "Agreement",
    payload: z.object({
      reason: z.enum(["no_text_layer", "corrupt", "unsupported", "too_large", "anonymization_failed"]),
      message: z.string(),
    }),
  },
  /** Personal data was replaced with placeholders before any model call. Values stay in agreement_texts, never in events. */
  AgreementAnonymized: {
    stream: "Agreement",
    payload: z.object({
      engine: z.string(),
      language: AgreementLanguage,
      entityCounts: z.record(z.string(), z.number().int()),
      entityTotal: z.number().int(),
      anonymizedSha256: z.string().length(64),
    }),
  },
  AgreementViewed: { stream: "Agreement", payload: z.object({}) },
  AgreementDownloaded: { stream: "Agreement", payload: z.object({}) },
  AgreementPreviewed: { stream: "Agreement", payload: z.object({}) },
  AuditRunRequested: {
    stream: "AuditRun",
    payload: z.object({
      agreementId: z.string().uuid(),
      ruleSnapshot: z.array(z.object({ ruleId: z.string().uuid(), version: z.number().int() })).min(1),
      model: z.string(),
      /** The decided provider/model; the worker builds its client from this, so later admin changes do not affect the run. */
      modelConfig: AuditModelConfig.nullable().default(null),
    }),
  },
  AuditRunStarted: { stream: "AuditRun", payload: z.object({ workerId: z.string(), startNo: z.number().int() }) },
  AuditRunClaudeCalled: {
    stream: "AuditRun",
    payload: z.object({
      attemptNo: z.number().int(),
      model: z.string(),
      promptSha256: z.string().length(64),
      promptChars: z.number().int(),
      /** "vote" for extra answers requested by majority voting. Absent on older events. */
      purpose: z.enum(["audit", "vote"]).optional(),
    }),
  },
  AuditRunClaudeResponded: {
    stream: "AuditRun",
    payload: z.object({
      attemptNo: z.number().int(),
      ok: z.boolean(),
      durationMs: z.number().int(),
      costUsd: z.number().min(0),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cacheReadTokens: z.number().int(),
      cacheWriteTokens: z.number().int(),
      numTurns: z.number().int(),
      model: z.string().nullable(),
      sessionId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  AuditRunClaudeOutputRejected: {
    stream: "AuditRun",
    payload: z.object({ attemptNo: z.number().int(), validationErrors: z.array(z.string()) }),
  },
  AuditRunFindingsVoted: {
    stream: "AuditRun",
    payload: z.object({
      mode: z.enum(["uncertain", "all"]),
      samples: z.number().int(),
      rules: z.array(z.object({ ruleId: z.string().uuid(), votes: z.array(FindingStatus), final: FindingStatus, changed: z.boolean() })),
    }),
  },
  AuditRunCompleted: {
    stream: "AuditRun",
    payload: z.object({
      verdict: Verdict,
      summary: z.string(),
      findings: z.array(StoredFinding),
      agreementMetadata: AgreementMetadata,
      totalCostUsd: z.number().min(0),
    }),
  },
  AuditRunFailed: {
    stream: "AuditRun",
    payload: z.object({ reason: z.string(), retryable: z.boolean(), totalCostUsd: z.number().min(0) }),
  },
  AuditRunCancelled: { stream: "AuditRun", payload: z.object({}) },
  AuditRunRetried: { stream: "AuditRun", payload: z.object({}) },
  AuditReportViewed: { stream: "AuditRun", payload: z.object({}) },
  WorkerStarted: {
    stream: "System",
    payload: z.object({ workerId: z.string(), version: z.string(), hostname: z.string() }),
  },
  WorkerStopped: {
    stream: "System",
    payload: z.object({ workerId: z.string(), reason: z.string() }),
  },
  AuditModelConfigured: {
    stream: "System",
    payload: AuditModelConfig.extend({ label: z.string() }),
  },
  AuditModelReset: {
    stream: "System",
    payload: z.object({ label: z.string() }),
  },
  AnonymizationConfigured: { stream: "System", payload: AnonymizationConfig },
  AnonymizationReset: { stream: "System", payload: z.object({}) },
} as const satisfies Record<string, { stream: StreamType; payload: z.ZodTypeAny }>;

export type EventType = keyof typeof eventRegistry;
export const eventTypes = Object.keys(eventRegistry) as EventType[];

export type EventPayload<T extends EventType> = z.infer<(typeof eventRegistry)[T]["payload"]>;

/** An event as produced by a command handler, before it is stored. */
export type NewEvent = {
  [T in EventType]: { type: T; payload: EventPayload<T> };
}[EventType];

/** An event as read back from the store. */
export type StoredEvent = NewEvent & {
  globalPosition: number;
  eventId: string;
  streamType: StreamType;
  streamId: string;
  streamVersion: number;
  eventVersion: number;
  metadata: EventMetadata;
  occurredAt: Date;
};

/** Event types that only record that somebody looked at something. */
export const readEventTypes: ReadonlySet<string> = new Set<string>([
  "RuleViewed",
  "AgreementViewed",
  "AgreementDownloaded",
  "AgreementPreviewed",
  "AuditReportViewed",
]);

/** AuditRun events that non-admins may see on a report timeline. Anything else stays admin-only. */
export const auditRunLifecycleEventTypes: ReadonlySet<string> = new Set<string>([
  "AuditRunRequested",
  "AuditRunStarted",
  "AuditRunCompleted",
  "AuditRunFailed",
  "AuditRunCancelled",
  "AuditRunRetried",
]);

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(eventRegistry, value);
}

export function parseEvent(type: string, payload: unknown): NewEvent {
  if (!isEventType(type)) throw new Error(`Unknown event type ${type}`);
  const parsed = eventRegistry[type].payload.parse(payload);
  return { type, payload: parsed } as NewEvent;
}

export function streamTypeOf(type: EventType): StreamType {
  return eventRegistry[type].stream;
}
