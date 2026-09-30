import type { NewEvent } from "./events.ts";

/** One-line human summary of an event for the audit log view. */
export function describeEvent(event: NewEvent, entityLabel: string | null): string {
  const who = entityLabel ?? "unknown";
  switch (event.type) {
    case "UserRegistered":
      return `${event.payload.email} registered as ${event.payload.role}`;
    case "UserRoleChanged":
      return `${who} role changed from ${event.payload.oldRole} to ${event.payload.newRole}`;
    case "UserDeactivated":
      return `${who} deactivated${event.payload.reason ? `: ${event.payload.reason}` : ""}`;
    case "UserReactivated":
      return `${who} reactivated`;
    case "OtpRequested":
      return `Login code requested for ${who}`;
    case "OtpVerified":
      return `${who} logged in${event.payload.usedDevCode ? " with the development code" : ""}`;
    case "OtpVerificationFailed":
      return event.payload.lockedUntil
        ? `Login failed for ${who} (${event.payload.reason}); locked until ${event.payload.lockedUntil}`
        : `Login failed for ${who} (${event.payload.reason})`;
    case "UserLoggedOut":
      return `${who} logged out`;
    case "RuleCreated":
      return `Rule "${event.payload.title}" created (${event.payload.severity})`;
    case "RuleUpdated":
      return `Rule "${event.payload.title}" updated: ${event.payload.changedFields.join(", ")}`;
    case "RuleArchived":
      return `Rule ${who} archived`;
    case "RuleRestored":
      return `Rule ${who} restored`;
    case "RuleViewed":
      return `Rule ${who} viewed`;
    case "AgreementUploaded":
      return `Agreement ${event.payload.fileName} uploaded as ${event.payload.agreementType} (${Math.ceil(event.payload.sizeBytes / 1024)} KB)`;
    case "AgreementTextExtracted":
      return `Text extracted from ${who}: ${event.payload.charCount.toLocaleString("en")} characters${event.payload.pageCount ? `, ${event.payload.pageCount} pages` : ""}${event.payload.sectionCount ? `, ${event.payload.sectionCount} sections` : ""}`;
    case "AgreementTextExtractionFailed":
      return `Text extraction failed for ${who} (${event.payload.reason})`;
    case "AgreementAnonymized":
      return `Personal data anonymized in ${who} before sending to the model: ${describeEntityCounts(event.payload.entityCounts)} (${event.payload.language.toUpperCase()}, ${event.payload.engine})`;
    case "AgreementDownloaded":
      return `Agreement ${who} downloaded`;
    case "AgreementPreviewed":
      return `Agreement ${who} previewed`;
    case "AgreementViewed":
      return `Agreement ${who} viewed`;
    case "AuditRunRequested":
      return `Audit requested for ${who} against ${event.payload.ruleSnapshot.length} rules`;
    case "AuditRunStarted":
      return `Audit of ${who} started by ${event.payload.workerId}${event.payload.startNo > 1 ? ` (start ${event.payload.startNo})` : ""}`;
    case "AuditRunClaudeCalled":
      return `Model ${event.payload.model} called for ${who}, attempt ${event.payload.attemptNo}${event.payload.purpose === "vote" ? " (vote)" : ""}`;
    case "AuditRunClaudeResponded":
      return event.payload.ok
        ? `Model answered for ${who} in ${(event.payload.durationMs / 1000).toFixed(1)} s, $${event.payload.costUsd.toFixed(4)}`
        : `Model call failed for ${who}: ${event.payload.error ?? "unknown error"}`;
    case "AuditRunClaudeOutputRejected":
      return `Model answer for ${who} rejected: ${event.payload.validationErrors.length} problem(s)`;
    case "AuditRunFindingsVoted": {
      const changed = event.payload.rules.filter((r) => r.changed).length;
      return `${event.payload.rules.length} finding(s) of ${who} re-checked by ${event.payload.samples} extra model answers; ${changed} changed by majority vote`;
    }
    case "AuditRunCompleted":
      return `Audit of ${who} completed: ${event.payload.verdict.toUpperCase()}, $${event.payload.totalCostUsd.toFixed(4)}`;
    case "AuditRunFailed":
      return `Audit of ${who} failed: ${event.payload.reason}`;
    case "AuditRunCancelled":
      return `Audit of ${who} cancelled`;
    case "AuditRunRetried":
      return `Audit of ${who} retried`;
    case "AuditReportViewed":
      return `Audit report for ${who} viewed`;
    case "WorkerStarted":
      return `Worker ${event.payload.workerId} started on ${event.payload.hostname}`;
    case "WorkerStopped":
      return `Worker ${event.payload.workerId} stopped (${event.payload.reason})`;
    case "AuditModelConfigured":
      return `Audit model set to ${event.payload.label}`;
    case "AuditModelReset":
      return `Audit model reset to the environment default ${event.payload.label}`;
    case "AnonymizationConfigured": {
      const p = event.payload;
      const off = [
        ...p.disabledLabels,
        ...(p.personCues ? [] : ["name cues"]),
        ...(p.propagate ? [] : ["later mentions"]),
        ...(p.inflection ? [] : ["Polish inflection"]),
        ...(p.ner ? [] : ["NER model"]),
      ];
      return `Anonymization settings changed: ${off.length ? `off: ${off.join(", ")}` : "every technique on"}; ${p.keep.length} kept term${p.keep.length === 1 ? "" : "s"}`;
    }
    case "AnonymizationReset":
      return "Anonymization settings reset to the defaults";
  }
}

/** "3 PERSON, 2 ORG" or "nothing found". */
function describeEntityCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n} ${label}`);
  return parts.length ? parts.join(", ") : "nothing found";
}
