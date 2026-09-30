import type { AgreementDto, AuditLogEntryDto, AuditRunSummaryDto, RuleDto, UserDto } from "@app/contracts";
import type { agreements, auditLog, auditRuns, rules, users } from "@app/db";

export function toUserDto(u: typeof users.$inferSelect): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    version: u.version,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Non-admin timeline entries lose the dollar suffix describeEvent adds to completion
 * summaries, and their payload and metadata. The route already limits them to lifecycle events.
 */
export function redactTimeline(entries: AuditLogEntryDto[], showCosts: boolean): AuditLogEntryDto[] {
  if (showCosts) return entries;
  return entries.map((t) => ({ ...t, summary: t.summary.replace(/, \$[\d.]+$/, ""), payload: null, metadata: null }));
}

export function toAuditLogDto(r: typeof auditLog.$inferSelect): AuditLogEntryDto {
  return {
    globalPosition: r.globalPosition,
    eventId: r.eventId,
    occurredAt: r.occurredAt.toISOString(),
    actorId: r.actorId,
    actorLabel: r.actorLabel,
    actorType: r.actorType,
    eventType: r.eventType,
    streamType: r.streamType,
    streamId: r.streamId,
    entityLabel: r.entityLabel,
    summary: r.summary,
    isRead: r.isRead,
    payload: r.payload,
    metadata: r.metadata,
  };
}

export function toRuleDto(r: typeof rules.$inferSelect): RuleDto {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    appliesTo: r.appliesTo as RuleDto["appliesTo"],
    languages: r.languages,
    status: r.status,
    version: r.version,
    contentVersion: r.contentVersion,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toAgreementDto(a: typeof agreements.$inferSelect, showCosts: boolean): AgreementDto {
  return {
    id: a.id,
    title: a.title,
    fileName: a.fileName,
    format: a.format,
    sizeBytes: a.sizeBytes,
    agreementType: a.agreementType,
    extractionStatus: a.extractionStatus,
    extractionError: a.extractionError,
    charCount: a.charCount,
    language: a.language,
    anonymizedEntityCount: a.anonymizedEntityCount,
    pageCount: a.pageCount,
    latestRunId: a.latestRunId,
    latestRunStatus: a.latestRunStatus as AgreementDto["latestRunStatus"],
    latestVerdict: a.latestVerdict as AgreementDto["latestVerdict"],
    ...(showCosts ? { totalCostUsd: a.totalCostUsd } : {}),
    version: a.version,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toRunSummaryDto(r: typeof auditRuns.$inferSelect, agreementTitle: string, showCosts: boolean): AuditRunSummaryDto {
  return {
    id: r.id,
    agreementId: r.agreementId,
    agreementTitle,
    status: r.status,
    verdict: r.verdict,
    ruleCount: r.ruleSnapshot.length,
    modelCalls: r.modelCalls,
    rejectedOutputs: r.rejectedOutputs,
    failureReason: r.failureReason,
    ...(showCosts
      ? {
          model: r.model,
          totalCostUsd: r.totalCostUsd,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          modelDurationMs: r.modelDurationMs,
        }
      : {}),
    requestedAt: r.requestedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    version: r.version,
  };
}
