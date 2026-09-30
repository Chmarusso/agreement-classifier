import type { TextViewDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { EntityTable, highlightEntities, languageLabel, TextViewToggle } from "../components/AnonymizedText.tsx";
import { AlertIcon, DownloadIcon, EyeIcon, GlobeIcon, ShieldIcon, verdictIcon } from "../components/icons.tsx";
import { Badge, Button, Card, EmptyState, ErrorState, formatTime, PageSpinner, Skeleton, Spinner } from "../components/ui.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { kb, runInProgress, runStatusLabel, seconds, tokens, usd, verdictLabel, verdictTone } from "../lib/format.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";
import { ExtractionBadge, LatestRun } from "./AgreementsPage.tsx";

export function AgreementDetailPage() {
  const { agreementId } = useParams({ strict: false }) as { agreementId: string };
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showText, setShowText] = useState(false);
  const [view, setView] = useState<TextViewDto>("original");
  const [showEntities, setShowEntities] = useState(false);

  const detail = useQuery({
    queryKey: ["agreement", agreementId],
    queryFn: () => api.agreement(agreementId),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.extractionStatus === "pending" || q.state.data.runs.some((r) => runInProgress(r.status)))
        ? 1500
        : false,
  });
  const text = useQuery({
    queryKey: ["agreement-text", agreementId, view],
    queryFn: () => api.agreementText(agreementId, view),
    enabled: showText && detail.data?.extractionStatus === "extracted",
  });
  const audit = useMutation({
    mutationFn: () => api.requestAudit(agreementId),
    onSuccess: (run) => {
      toast.success(`Audit queued against ${run.ruleCount} rules`);
      void qc.invalidateQueries({ queryKey: ["agreement", agreementId] });
      void qc.invalidateQueries({ queryKey: ["agreements"] });
      void navigate({ to: "/audits/$runId", params: { runId: run.id } });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  usePageTitle(detail.data?.title);
  if (detail.isPending) return <PageSpinner label="Loading agreement" />;
  if (detail.error)
    return (
      <Card>
        <ErrorState
          error={detail.error}
          onRetry={() => detail.refetch()}
          retrying={detail.isFetching}
          title="Could not load this agreement"
        />
      </Card>
    );

  const a = detail.data;
  const latest = a.runs[0] ?? null;
  const canAudit = me.data?.role !== "viewer";
  const showCosts = me.data?.role === "admin";
  const running = a.runs.some((r) => runInProgress(r.status));
  const disabledReason =
    a.extractionStatus === "pending"
      ? "Extracting text; the audit starts automatically"
      : a.extractionStatus === "failed"
        ? "Text extraction failed"
        : a.applicableRuleCount === 0
          ? `No active rules apply to ${a.agreementType}`
          : running
            ? "An audit is already running"
            : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {latest ? (
              <Link to="/audits/$runId" params={{ runId: latest.id }} title="Open the latest audit report" className="mt-0.5 shrink-0">
                <LatestRun a={a} />
              </Link>
            ) : (
              <span className="mt-0.5 shrink-0">
                <LatestRun a={a} />
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{a.title}</h1>
              <p className="text-sm text-muted">
                {a.agreementType} · {a.fileName} · {kb(a.sizeBytes)} · uploaded {formatTime(a.createdAt)}
                {latest && ` · last audit ${formatTime(latest.requestedAt)}`}
              </p>
            </div>
          </div>
          {canAudit && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => audit.mutate()} loading={audit.isPending} disabled={!!disabledReason}>
                Run audit
              </Button>
              <span className="text-xs text-muted">{disabledReason ?? `${a.applicableRuleCount} rules apply to ${a.agreementType}`}</span>
            </div>
          )}
        </div>
      </div>

      <Card
        title="Document"
        action={
          <div className="flex items-center gap-4">
            <a
              className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
              href={`/api/v1/agreements/${a.id}/preview`}
              target="_blank"
              rel="noopener"
            >
              <EyeIcon size={14} /> Preview original
            </a>
            <a
              className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
              href={`/api/v1/agreements/${a.id}/file`}
            >
              <DownloadIcon size={14} /> Download original
            </a>
          </div>
        }
      >
        <div className="flex flex-col gap-3 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <ExtractionBadge a={a} />
            {a.language && (
              <Badge tone="neutral">
                <GlobeIcon /> {languageLabel[a.language]}
              </Badge>
            )}
            {a.extractionStatus === "extracted" &&
              (a.anonymizedEntityCount !== null ? (
                <Badge tone="good">
                  <ShieldIcon /> Anonymized · {a.anonymizedEntityCount} items replaced
                </Badge>
              ) : (
                <Badge tone="warn">
                  <AlertIcon /> Not anonymized
                </Badge>
              ))}
            {a.extractionStatus === "extracted" && (
              <span className="text-muted">
                {a.charCount?.toLocaleString("en")} characters{a.pageCount ? ` · ${a.pageCount} pages` : ""}
              </span>
            )}
          </div>
          {a.extractionStatus === "extracted" && a.anonymizedEntityCount === null && (
            <p className="text-muted">
              The model receives this text as extracted. Set ANONYMIZER_URL on the worker to replace personal data first.
            </p>
          )}
          {a.extractionStatus === "failed" && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">
              {a.extractionError}
            </p>
          )}
          {a.extractionStatus === "extracted" && (
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setShowText((s) => !s)}>
                  {showText ? "Hide extracted text" : "Show extracted text"}
                </Button>
                {showText && a.anonymizedEntityCount !== null && <TextViewToggle view={view} onChange={setView} />}
                {showText && text.data?.anonymization && (
                  <button
                    type="button"
                    className="text-sm font-medium text-link hover:underline"
                    onClick={() => setShowEntities((s) => !s)}
                  >
                    {showEntities ? "Hide replacements" : `Show replacements (${text.data.anonymization.entities.length})`}
                  </button>
                )}
              </div>
              {showText && showEntities && text.data?.anonymization && (
                <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-line">
                  <EntityTable entities={text.data.anonymization.entities} />
                </div>
              )}
              {showText &&
                (text.isPending ? (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-4/6" />
                  </div>
                ) : text.error ? (
                  <ErrorState error={text.error} onRetry={() => text.refetch()} />
                ) : (
                  <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-md border border-line">
                    <p className="border-b border-line bg-canvas px-4 py-2 text-xs text-muted">
                      {text.data.sections.length} sections found. The model cites these ids, and the report links quotes to them.
                      {text.data.anonymization &&
                        (text.data.view === "anonymized"
                          ? " This is exactly the text the model receives; hover a placeholder to see the value it replaces."
                          : " Highlighted values are replaced before the text leaves this server; hover to see the placeholder.")}
                    </p>
                    <ol className="divide-y divide-line">
                      {text.data.sections.map((s) => (
                        <li key={s.id} className="grid grid-cols-[3.5rem_1fr] gap-3 px-4 py-3 text-sm">
                          <span className="font-mono text-xs text-muted">{s.id}</span>
                          <div>
                            <p className="font-medium">{s.label}</p>
                            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink/80">
                              {highlightEntities(
                                s.text
                                  .split("\n")
                                  .slice(s.number ? 1 : 0)
                                  .join("\n"),
                                text.data.anonymization?.entities ?? [],
                                text.data.view,
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Audits">
        {a.runs.length === 0 ? (
          <EmptyState title="Not audited yet" body={disabledReason ?? "Run an audit to check this agreement against the rules."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Requested</th>
                  <th className="px-5 py-3 font-medium">Result</th>
                  <th className="px-5 py-3 font-medium">Rules</th>
                  {showCosts && (
                    <>
                      <th className="px-5 py-3 font-medium">Model</th>
                      <th className="px-5 py-3 text-right font-medium">Calls</th>
                      <th className="px-5 py-3 text-right font-medium">Tokens in / out</th>
                      <th className="px-5 py-3 text-right font-medium">Time</th>
                      <th className="px-5 py-3 text-right font-medium">Cost</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.runs.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas">
                    <td className="whitespace-nowrap px-5 py-3">
                      <Link to="/audits/$runId" params={{ runId: r.id }} className="font-medium text-link hover:underline">
                        {formatTime(r.requestedAt)}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      {runInProgress(r.status) ? (
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <Spinner size={12} label={runStatusLabel[r.status]} /> {runStatusLabel[r.status]}
                        </span>
                      ) : r.verdict ? (
                        <Badge tone={verdictTone[r.verdict]}>
                          {verdictIcon[r.verdict]} {verdictLabel[r.verdict]}
                        </Badge>
                      ) : (
                        <Badge tone={r.status === "failed" ? "bad" : "neutral"}>{runStatusLabel[r.status]}</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 tabular-nums">{r.ruleCount}</td>
                    {showCosts && (
                      <>
                        <td className="px-5 py-3 font-mono text-xs">{r.model}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{r.modelCalls}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {tokens(r.inputTokens ?? 0)} / {tokens(r.outputTokens ?? 0)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{seconds(r.modelDurationMs ?? 0)}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">{usd(r.totalCostUsd ?? 0)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {showCosts && (
              <div className="border-t border-line px-5 py-3 text-right text-sm text-muted">
                Total model cost for this agreement: <span className="font-medium text-ink">{usd(a.totalCostUsd ?? 0)}</span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
