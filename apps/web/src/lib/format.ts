import type { FindingStatusDto, RunStatusDto, SeverityDto, VerdictDto } from "@app/contracts";

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`);
export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type Tone = "good" | "warn" | "bad" | "neutral" | "brand";

export const verdictTone: Record<VerdictDto, Tone> = { pass: "good", warn: "warn", fail: "bad" };
export const verdictLabel: Record<VerdictDto, string> = { pass: "Pass", warn: "Needs review", fail: "Fail" };

export const statusTone: Record<FindingStatusDto, Tone> = {
  pass: "good",
  fail: "bad",
  partial: "warn",
  unclear: "warn",
  not_applicable: "neutral",
};
export const statusLabel: Record<FindingStatusDto, string> = {
  pass: "Pass",
  fail: "Fail",
  partial: "Partial",
  unclear: "Unclear",
  not_applicable: "Not applicable",
};

export const severityTone: Record<SeverityDto, Tone> = { critical: "bad", high: "warn", medium: "brand", low: "neutral" };

export const runStatusLabel: Record<RunStatusDto, string> = {
  requested: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
export const runInProgress = (s: RunStatusDto | null | undefined) => s === "requested" || s === "running";
