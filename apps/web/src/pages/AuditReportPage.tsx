import type { FindingDto, SeverityDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertIcon, CheckIcon, findingIcon, ShieldIcon, verdictIcon } from "../components/icons.tsx";
import { Badge, Button, Card, Drawer, ErrorState, formatDate, formatTime, PageSpinner, Spinner } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import {
  runInProgress,
  runStatusLabel,
  seconds,
  severityTone,
  statusLabel,
  statusTone,
  tokens,
  usd,
  verdictLabel,
  verdictTone,
} from "../lib/format.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";

const severities: SeverityDto[] = ["critical", "high", "medium", "low"];

/** Problems first, passes at the bottom; within a group the most severe rules come first. */
const findingGroups: { title: string; statuses: FindingDto["status"][]; tone: "bad" | "warn" | "good" | "neutral" }[] = [
  { title: "Failed", statuses: ["fail"], tone: "bad" },
  { title: "Needs review", statuses: ["partial", "unclear"], tone: "warn" },
  { title: "Passed", statuses: ["pass"], tone: "good" },
  { title: "Not applicable", statuses: ["not_applicable"], tone: "neutral" },
];
const timelineLabels: Record<string, string> = {
  AuditRunClaudeCalled: "Model called",
  AuditRunClaudeResponded: "Model answered",
  AuditRunClaudeOutputRejected: "Answer rejected",
  AuditRunFindingsVoted: "Votes",
};
function callBreakdown(timeline: { eventType: string; payload: unknown }[], total: number, rejected: number): string {
  const votes = timeline.filter(
    (t) => t.eventType === "AuditRunClaudeCalled" && (t.payload as { purpose?: string }).purpose === "vote",
  ).length;
  const parts = [`${total - votes} audit`];
  if (votes) parts.push(`${votes} vote${votes > 1 ? "s" : ""}`);
  return `${parts.join(" + ")}${rejected ? ` · ${rejected} rejected and retried` : ""}`;
}

const timelineLabel = (type: string) => timelineLabels[type] ?? type.replace("AuditRun", "");

/** One rule's result. The header row is always visible; the explanation, quotes and fix open on click. */
function Finding({ f }: { f: FindingDto }) {
  const [open, setOpen] = useState(false);
  const detailsId = `finding-${f.ruleId}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-2 px-5 py-3 text-left hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Badge tone={statusTone[f.status]}>
          {findingIcon[f.status]} {statusLabel[f.status]}
        </Badge>
        <span className="font-medium">{f.ruleTitle}</span>
        <Badge tone={severityTone[f.severity]}>{f.severity}</Badge>
        {f.votes && (
          <span title="Majority vote over several model answers; the first is the original" className="text-xs text-muted">
            <Badge tone={new Set(f.votes).size > 1 ? "warn" : "neutral"}>voted {f.votes.length}×</Badge>{" "}
            {f.votes.map((v) => statusLabel[v]).join(" · ")}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">confidence {Math.round(f.confidence * 100)}%</span>
      </button>
      {open && (
        <div id={detailsId} className="flex flex-col gap-2 px-5 pb-4 pl-10">
          <p className="text-sm text-ink/90">{f.explanation}</p>
          {f.evidence.map((e, i) => (
            <blockquote key={`${f.ruleId}-${i}`} className="border-l-2 border-line pl-3 text-sm">
              <span className="italic text-ink/80">“{e.quote}”</span>{" "}
              {e.verified ? (
                <Badge tone="good">
                  <CheckIcon /> found in text
                </Badge>
              ) : (
                <Badge tone="warn">
                  <AlertIcon /> not found in text
                </Badge>
              )}
              {e.location && <span className="ml-1 text-xs font-medium text-ink/70">{e.location}</span>}
              {e.citedSectionId && e.sectionId && e.citedSectionId !== e.sectionId && (
                <span className="ml-1 text-xs text-muted">
                  (model cited {e.citedSectionId}, found in {e.sectionId})
                </span>
              )}
            </blockquote>
          ))}
          {f.recommendation && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Recommendation:</span> {f.recommendation}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function AuditReportPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const me = useMe();
  const qc = useQueryClient();
  const [showPrompt, setShowPrompt] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const run = useQuery({
    queryKey: ["audit", runId],
    queryFn: () => api.audit(runId),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (runInProgress(q.state.data?.status) ? 1500 : false),
  });
  const prompts = useQuery({ queryKey: ["audit-prompts", runId], queryFn: () => api.auditPrompts(runId), enabled: showPrompt });
  const onDone = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ["audit", runId] });
    void qc.invalidateQueries({ queryKey: ["agreements"] });
  };
  const cancel = useMutation({
    mutationFn: () => api.cancelAudit(runId, run.data!.version),
    onSuccess: () => onDone("Audit cancelled"),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: () => api.retryAudit(runId, run.data!.version),
    onSuccess: () => onDone("Audit queued again"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  usePageTitle(run.data ? `Audit of ${run.data.agreementTitle}` : "Audit report");
  if (run.isPending) return <PageSpinner label="Loading audit" />;
  if (run.error)
    return (
      <Card>
        <ErrorState error={run.error} onRetry={() => run.refetch()} retrying={run.isFetching} title="Could not load this audit" />
      </Card>
    );
  const r = run.data;
  const canAct = me.data?.role !== "viewer";
  const showCosts = me.data?.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/agreements/$agreementId" params={{ agreementId: r.agreementId }} className="text-sm text-muted hover:text-ink">
          ← {r.agreementTitle}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {r.status === "completed" && r.verdict && (
            <Badge tone={verdictTone[r.verdict]} className="w-32 justify-center">
              {verdictIcon[r.verdict]} {verdictLabel[r.verdict]}
            </Badge>
          )}
          <h1 className="text-xl font-semibold">Audit report</h1>
          <time dateTime={r.requestedAt} title={`Requested ${formatTime(r.requestedAt)}`} className="ml-auto text-sm text-muted">
            {formatDate(r.requestedAt)}
          </time>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">
            {r.ruleCount} rules · {r.agreement.agreementType}
          </p>
          {r.anonymized && (
            <span title="Personal data was replaced with placeholders before the model call">
              <Badge tone="good">
                <ShieldIcon /> Anonymized
              </Badge>
            </span>
          )}
        </div>
      </div>

      {runInProgress(r.status) ? (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-white px-5 py-4">
          <Spinner size={20} label="Audit in progress" />
          <div>
            <p className="font-medium">{runStatusLabel[r.status]}…</p>
            <p className="text-sm text-muted">
              {r.status === "requested"
                ? "Waiting for the worker to pick up the job."
                : `Asking ${r.model ?? "the audit model"} to check ${r.ruleCount} rules. ${r.modelCalls ? `Attempt ${r.modelCalls}.` : ""}`}
            </p>
          </div>
          {canAct && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              Cancel
            </Button>
          )}
        </div>
      ) : r.status === "completed" && r.verdict ? null : (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-5 py-4">
          <div>
            <p className="font-semibold text-danger">Audit {runStatusLabel[r.status].toLowerCase()}</p>
            {r.failureReason && <p className="mt-1 text-sm text-ink/80">{r.failureReason}</p>}
          </div>
          {canAct && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => retry.mutate()} loading={retry.isPending}>
              Retry audit
            </Button>
          )}
        </div>
      )}

      {showCosts && (
        <Card title="Model usage and cost">
          <div className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
            <Stat label="Model" value={r.model?.split("/").slice(-1)[0] ?? "unknown"} sub={r.model} />
            <Stat label="Cost" value={usd(r.totalCostUsd ?? 0)} sub="USD, as reported by the provider" />
            <Stat label="Tokens" value={`${tokens(r.inputTokens ?? 0)} / ${tokens(r.outputTokens ?? 0)}`} sub="input / output" />
            <Stat label="Model time" value={seconds(r.modelDurationMs ?? 0)} sub="summed over calls; votes run in parallel" />
            <Stat label="Calls" value={String(r.modelCalls)} sub={callBreakdown(r.timeline, r.modelCalls, r.rejectedOutputs)} />
          </div>
          <div className="flex gap-2 border-t border-line px-5 py-3">
            <Button variant="secondary" size="sm" onClick={() => setShowPrompt(true)} disabled={r.modelCalls === 0}>
              View prompt and raw answer
            </Button>
            {r.findings.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowRaw((s) => !s)}>
                {showRaw ? "Hide findings JSON" : "Show findings JSON"}
              </Button>
            )}
          </div>
          {showRaw && (
            <pre className="max-h-96 overflow-auto border-t border-line bg-canvas p-4 font-mono text-xs">
              {JSON.stringify(r.findings, null, 2)}
            </pre>
          )}
        </Card>
      )}

      {findingGroups.map((g) => {
        const items = r.findings
          .filter((f) => g.statuses.includes(f.status))
          .sort((x, y) => severities.indexOf(x.severity) - severities.indexOf(y.severity));
        if (!items.length) return null;
        return (
          <Card
            key={g.title}
            title={
              <span className="flex items-center gap-2">
                {g.title} <Badge tone={g.tone}>{items.length}</Badge>
              </span>
            }
          >
            <ul className="divide-y divide-line">
              {items.map((f) => (
                <Finding key={f.ruleId} f={f} />
              ))}
            </ul>
          </Card>
        );
      })}

      <Card title="Timeline">
        <ol className="divide-y divide-line">
          {r.timeline.map((t) => (
            <li key={t.eventId} className="flex items-center gap-4 px-5 py-2.5 text-sm">
              <span className="w-44 shrink-0 text-muted tabular-nums">{formatTime(t.occurredAt)}</span>
              <Badge>{timelineLabel(t.eventType)}</Badge>
              <span className="min-w-0 flex-1 truncate">{t.summary}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Drawer open={showPrompt} onClose={() => setShowPrompt(false)} title="Prompts and raw answers">
        {prompts.isPending ? (
          <PageSpinner label="Loading prompts" />
        ) : prompts.error ? (
          <ErrorState error={prompts.error} onRetry={() => prompts.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            {prompts.data.map((p) => (
              <section key={p.attemptNo} className="flex flex-col gap-2">
                <h3 className="font-semibold">
                  Attempt {p.attemptNo} <span className="font-mono text-xs font-normal text-muted">{p.model}</span>
                </h3>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">System prompt</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-xs">{p.systemPrompt}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">
                    Prompt ({p.prompt.length.toLocaleString("en")} characters)
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 font-mono text-xs">
                    {p.prompt}
                  </pre>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Raw provider response</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-canvas p-3 font-mono text-xs">
                    {JSON.stringify(p.rawResponse, null, 2)}
                  </pre>
                </details>
              </section>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
