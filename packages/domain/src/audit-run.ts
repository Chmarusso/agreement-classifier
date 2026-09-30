import { AppError } from "./errors.ts";
import type { AuditModelConfig, EventPayload, NewEvent, StoredEvent } from "./events.ts";
import { ev } from "./user.ts";

export type AuditRunStatus = "requested" | "running" | "completed" | "failed" | "cancelled";
export const terminalStatuses: ReadonlySet<AuditRunStatus> = new Set(["completed", "failed", "cancelled"]);

export interface AuditRunState {
  exists: boolean;
  status: AuditRunStatus;
  starts: number;
  claudeAttempts: number;
  costUsd: number;
  /** Model decided at request time; null on runs requested before this was recorded. */
  modelConfig: AuditModelConfig | null;
}

export const initialAuditRunState = (): AuditRunState => ({
  exists: false,
  status: "requested",
  starts: 0,
  claudeAttempts: 0,
  costUsd: 0,
  modelConfig: null,
});

export function evolveAuditRun(s: AuditRunState, e: StoredEvent | NewEvent): AuditRunState {
  switch (e.type) {
    case "AuditRunRequested":
      return { ...s, exists: true, status: "requested", modelConfig: e.payload.modelConfig };
    case "AuditRunStarted":
      return { ...s, status: "running", starts: e.payload.startNo };
    case "AuditRunClaudeCalled":
      return { ...s, claudeAttempts: e.payload.attemptNo };
    case "AuditRunClaudeResponded":
      return { ...s, costUsd: s.costUsd + e.payload.costUsd };
    case "AuditRunCompleted":
      return { ...s, status: "completed" };
    case "AuditRunFailed":
      return { ...s, status: "failed" };
    case "AuditRunCancelled":
      return { ...s, status: "cancelled" };
    case "AuditRunRetried":
      return { ...s, status: "requested", claudeAttempts: 0 };
    default:
      return s;
  }
}

export type AuditRunCommand =
  | ({ type: "RequestAudit" } & EventPayload<"AuditRunRequested">)
  | { type: "StartAudit"; workerId: string }
  | ({ type: "RecordClaudeCall" } & Omit<EventPayload<"AuditRunClaudeCalled">, "attemptNo">)
  | ({ type: "RecordClaudeResponse" } & EventPayload<"AuditRunClaudeResponded">)
  | ({ type: "RejectOutput" } & EventPayload<"AuditRunClaudeOutputRejected">)
  | ({ type: "RecordVote" } & EventPayload<"AuditRunFindingsVoted">)
  | ({ type: "CompleteAudit" } & Omit<EventPayload<"AuditRunCompleted">, "totalCostUsd">)
  | { type: "FailAudit"; reason: string; retryable: boolean }
  | { type: "CancelAudit" }
  | { type: "RetryAudit" }
  | { type: "ViewReport" };

const conflict = (msg: string) => new AppError("CONFLICT", msg);

/** Enforces the audit-run state machine from PLAN.md section 6.2. */
export function decideAuditRun(s: AuditRunState, cmd: AuditRunCommand): NewEvent[] {
  if (cmd.type === "RequestAudit") {
    if (s.exists) throw conflict("Audit run already exists.");
    const { type: _t, ...payload } = cmd;
    return [ev("AuditRunRequested", payload)];
  }
  if (!s.exists) throw new AppError("NOT_FOUND", "Audit run not found.");
  const requireRunning = () => {
    if (s.status !== "running") throw conflict(`Audit run is ${s.status}, not running.`);
  };
  switch (cmd.type) {
    case "StartAudit":
      if (s.status !== "requested" && s.status !== "running") throw conflict(`Cannot start an audit run that is ${s.status}.`);
      return [ev("AuditRunStarted", { workerId: cmd.workerId, startNo: s.starts + 1 })];
    case "RecordClaudeCall": {
      requireRunning();
      const { type: _t, ...rest } = cmd;
      return [ev("AuditRunClaudeCalled", { ...rest, attemptNo: s.claudeAttempts + 1 })];
    }
    case "RecordClaudeResponse": {
      requireRunning();
      const { type: _t, ...payload } = cmd;
      return [ev("AuditRunClaudeResponded", payload)];
    }
    case "RejectOutput": {
      requireRunning();
      const { type: _t, ...payload } = cmd;
      return [ev("AuditRunClaudeOutputRejected", payload)];
    }
    case "RecordVote": {
      requireRunning();
      const { type: _t, ...payload } = cmd;
      return [ev("AuditRunFindingsVoted", payload)];
    }
    case "CompleteAudit": {
      requireRunning();
      const { type: _t, ...payload } = cmd;
      return [ev("AuditRunCompleted", { ...payload, totalCostUsd: round6(s.costUsd) })];
    }
    case "FailAudit":
      if (s.status !== "running" && s.status !== "requested") throw conflict(`Cannot fail an audit run that is ${s.status}.`);
      return [ev("AuditRunFailed", { reason: cmd.reason, retryable: cmd.retryable, totalCostUsd: round6(s.costUsd) })];
    case "CancelAudit":
      if (terminalStatuses.has(s.status)) throw conflict(`The audit run is already ${s.status}.`);
      return [ev("AuditRunCancelled", {})];
    case "RetryAudit":
      if (s.status !== "failed" && s.status !== "cancelled") throw conflict("Only failed or cancelled runs can be retried.");
      return [ev("AuditRunRetried", {})];
    case "ViewReport":
      return [ev("AuditReportViewed", {})];
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
