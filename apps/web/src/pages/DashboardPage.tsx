import type { DashboardDto, RoleDto } from "@app/contracts";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AlertIcon, CheckIcon, CrossIcon, FileIcon, RulesIcon, verdictIcon } from "../components/icons.tsx";
import { UploadDialog } from "../components/UploadDialog.tsx";
import { Badge, Button, Card, ErrorState, relativeTime, Skeleton, SkeletonRows, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { runInProgress, runStatusLabel, tokens, usd, verdictLabel, verdictTone } from "../lib/format.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";
import type { AgreementSearch } from "./AgreementsPage.tsx";

type Dash = UseQueryResult<DashboardDto>;

const statTones = {
  neutral: { chip: "bg-canvas text-muted", value: "text-ink" },
  brand: { chip: "bg-brand/10 text-brand", value: "text-ink" },
  good: { chip: "bg-accent/10 text-accent", value: "text-accent" },
  warn: { chip: "bg-warn-soft text-warn", value: "text-warn" },
  bad: { chip: "bg-danger-soft text-danger", value: "text-danger" },
};

function Stat({
  label,
  value,
  sub,
  loading,
  icon,
  tone = "neutral",
  link,
}: {
  label: string;
  value?: ReactNode;
  sub?: string;
  loading: boolean;
  icon?: ReactNode;
  tone?: keyof typeof statTones;
  /** Makes the card open the list behind the number. */
  link?: { to: "/agreements" | "/rules"; search?: AgreementSearch };
}) {
  const t = statTones[tone];
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {icon && <span className={`grid h-7 w-7 place-items-center rounded-full ${t.chip}`}>{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${icon ? t.value : ""}`}>{value}</div>
      )}
      {sub && !loading && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </>
  );
  const box = "block rounded-xl border border-line bg-white px-5 py-4";
  return link ? (
    <Link
      to={link.to}
      search={(link.search ?? {}) as never}
      aria-label={`${label}: open the list`}
      className={`${box} transition-colors hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-brand`}
    >
      {content}
    </Link>
  ) : (
    <div className={box}>{content}</div>
  );
}

function VerdictBadges({ v }: { v: DashboardDto["verdicts"] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      <Badge tone="good">
        <CheckIcon /> {v.pass} pass
      </Badge>
      <Badge tone="warn">
        <AlertIcon /> {v.warn} review
      </Badge>
      <Badge tone="bad">
        <CrossIcon /> {v.fail} fail
      </Badge>
      {v.failedRuns > 0 && <Badge tone="neutral">{v.failedRuns} errored</Badge>}
    </div>
  );
}

function RecentAudits({ showCosts }: { showCosts: boolean }) {
  const runs = useQuery({
    queryKey: ["audits", "recent"],
    queryFn: () => api.audits(8),
    refetchInterval: (q) => (q.state.data?.some((r) => runInProgress(r.status)) ? 5_000 : 30_000),
  });
  return (
    <Card
      title="Recent audits"
      className="lg:col-span-2"
      action={
        <Link to="/agreements" className="text-sm font-medium text-link hover:underline">
          All agreements
        </Link>
      }
    >
      {runs.isPending ? (
        <SkeletonRows rows={5} />
      ) : runs.error ? (
        <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
      ) : runs.data.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No audits yet. Upload an agreement to start.</p>
      ) : (
        <ul className="divide-y divide-line">
          {runs.data.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              {r.verdict ? (
                <Badge tone={verdictTone[r.verdict]} className="w-32 shrink-0 justify-center">
                  {verdictIcon[r.verdict]} {verdictLabel[r.verdict]}
                </Badge>
              ) : runInProgress(r.status) ? (
                <Badge tone="brand" className="w-32 shrink-0 justify-center">
                  <Spinner size={10} label={runStatusLabel[r.status]} /> {runStatusLabel[r.status]}
                </Badge>
              ) : (
                <Badge tone="bad" className="w-32 shrink-0 justify-center">
                  <AlertIcon /> {runStatusLabel[r.status]}
                </Badge>
              )}
              <Link
                to="/audits/$runId"
                params={{ runId: r.id }}
                className="min-w-0 flex-1 truncate font-medium hover:text-link hover:underline"
              >
                {r.agreementTitle}
              </Link>
              <span className="hidden w-20 text-muted sm:block">{relativeTime(r.requestedAt)}</span>
              {showCosts && <span className="w-20 text-right tabular-nums">{usd(r.totalCostUsd ?? 0)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AdminDashboard({ dash }: { dash: Dash }) {
  const costs = useQuery({ queryKey: ["costs"], queryFn: api.costs, refetchInterval: 15_000 });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000, retry: false });
  const workerTone = health.data?.worker.status === "ok" ? "good" : health.data?.worker.status === "stale" ? "warn" : "bad";
  const c = costs.data;
  const maxDay = Math.max(0.000001, ...(c?.byDay.map((d) => d.costUsd) ?? [0]));

  return (
    <>
      {dash.error || costs.error ? (
        <Card>
          <ErrorState
            error={dash.error ?? costs.error}
            onRetry={() => void Promise.all([dash.refetch(), costs.refetch()])}
            retrying={dash.isFetching || costs.isFetching}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Model spend this month"
            value={c ? usd(c.thisMonth.costUsd) : undefined}
            sub={c ? `${c.thisMonth.runs} audit runs` : undefined}
            loading={costs.isPending}
          />
          <Stat
            label="Model spend, all time"
            value={c ? usd(c.total.costUsd) : undefined}
            sub={c ? `${tokens(c.total.inputTokens)} tokens in · ${tokens(c.total.outputTokens)} out` : undefined}
            loading={costs.isPending}
          />
          <Stat
            label="Average per audit"
            value={c ? usd(c.total.runs ? c.total.costUsd / c.total.runs : 0) : undefined}
            sub={c ? `${c.total.runs} runs` : undefined}
            loading={costs.isPending}
          />
          <Stat label="Verdicts" value={dash.data ? <VerdictBadges v={dash.data.verdicts} /> : undefined} loading={dash.isPending} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <RecentAudits showCosts />
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Spend by model">
            {c && c.byModel.length > 0 ? (
              <ul className="divide-y divide-line">
                {c.byModel.map((m) => (
                  <li key={m.model} className="px-5 py-3 text-sm">
                    <div className="truncate font-mono text-xs">{m.model}</div>
                    <div className="mt-0.5 flex justify-between text-muted">
                      <span>
                        {m.runs} runs · avg {usd(m.avgCostUsd)}
                      </span>
                      <span className="font-medium text-ink tabular-nums">{usd(m.costUsd)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">{costs.isPending ? "Loading…" : "No spend yet."}</p>
            )}
          </Card>
          <Card title="Daily spend, last 30 days">
            {c && c.byDay.length > 0 ? (
              <div className="flex h-28 items-end gap-1 px-5 py-4" role="img" aria-label="Daily model spend">
                {c.byDay.map((d) => (
                  <div
                    key={d.day}
                    className="max-w-6 flex-1 rounded-t bg-brand/70"
                    style={{ height: `${Math.max(4, (d.costUsd / maxDay) * 100)}%` }}
                    title={`${d.day}: ${usd(d.costUsd)}, ${d.runs} runs`}
                  />
                ))}
              </div>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">{costs.isPending ? "Loading…" : "No spend yet."}</p>
            )}
          </Card>
          <div className="rounded-xl border border-line bg-white px-5 py-4 text-sm">
            <span className="text-muted">Background worker: </span>
            {health.data ? <Badge tone={workerTone}>{health.data.worker.status}</Badge> : <Badge tone="neutral">…</Badge>}
            {dash.data && (
              <span className="ml-2 text-muted">
                {dash.data.rules.active} active rules · {dash.data.agreements.total} agreements · {dash.data.users.active} users
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Auditors and viewers: the headline numbers and the latest audits. */
function TeamDashboard({ dash }: { dash: Dash }) {
  const d = dash.data;
  const v = d?.verdicts;
  // Counted per agreement (its latest audit), so each number matches the filtered list it opens.
  const latest = d?.agreements.byLatestVerdict;
  return (
    <>
      {dash.error ? (
        <Card>
          <ErrorState error={dash.error} onRetry={() => dash.refetch()} retrying={dash.isFetching} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat
            label="Agreements"
            value={d?.agreements.total}
            loading={dash.isPending}
            icon={<FileIcon size={14} />}
            tone="brand"
            link={{ to: "/agreements" }}
          />
          <Stat
            label="Passed"
            value={latest?.pass}
            loading={dash.isPending}
            icon={<CheckIcon size={14} />}
            tone="good"
            link={{ to: "/agreements", search: { status: "pass" } }}
          />
          <Stat
            label="Need review"
            value={latest?.warn}
            loading={dash.isPending}
            icon={<AlertIcon size={14} />}
            tone="warn"
            link={{ to: "/agreements", search: { status: "warn" } }}
          />
          <Stat
            link={{ to: "/agreements", search: { status: "fail" } }}
            label="Failed"
            value={latest?.fail}
            sub={v?.failedRuns ? `${v.failedRuns} audit errors` : undefined}
            loading={dash.isPending}
            icon={<CrossIcon size={14} />}
            tone="bad"
          />
          <Stat
            icon={<RulesIcon size={14} />}
            link={{ to: "/rules" }}
            label="Active rules"
            value={d?.rules.active}
            sub={v?.inProgress ? `${v.inProgress} audit${v.inProgress > 1 ? "s" : ""} running` : undefined}
            loading={dash.isPending}
          />
        </div>
      )}

      <RecentAudits showCosts={false} />
    </>
  );
}

const subtitle: Record<RoleDto, string> = {
  admin: "Audits, verdicts and model spend across Eone agreements.",
  auditor: "How Eone agreements measure up against the company rules.",
  viewer: "How Eone agreements measure up against the company rules.",
};

export function DashboardPage() {
  usePageTitle("Dashboard");
  const me = useMe();
  const [uploading, setUploading] = useState(false);
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 15_000 });
  const role = me.data?.role;
  if (!role) return null; // AppLayout already handles the loading and error states
  const canUpload = role !== "viewer";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Eone dashboard</h1>
          <p className="text-sm text-muted">{subtitle[role]}</p>
        </div>
        {canUpload && <Button onClick={() => setUploading(true)}>Upload agreement</Button>}
      </div>
      {role === "admin" ? <AdminDashboard dash={dash} /> : <TeamDashboard dash={dash} />}
      {canUpload && <UploadDialog open={uploading} onClose={() => setUploading(false)} />}
    </div>
  );
}
