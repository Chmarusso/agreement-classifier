import {
  type AgreementDto,
  AgreementStatusFilter,
  AgreementTypeDto,
  agreementStatusFilters,
  agreementTypesDto,
  LanguageDto,
} from "@app/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertIcon, CheckIcon, CrossIcon, FilterIcon, MinusIcon, SearchIcon, verdictIcon } from "../components/icons.tsx";
import { UploadDialog } from "../components/UploadDialog.tsx";
import { Badge, Button, Card, EmptyState, ErrorState, Input, relativeTime, Select, SkeletonRows, Spinner } from "../components/ui.tsx";
import { type AgreementListParams, api } from "../lib/api.ts";
import { runInProgress, runStatusLabel, usd, verdictLabel, verdictTone } from "../lib/format.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";

/** Status labels share one width so the list columns line up. */
const status = "w-32 justify-center gap-1.5 whitespace-nowrap";

export function ExtractionBadge({ a }: { a: Pick<AgreementDto, "extractionStatus"> }) {
  if (a.extractionStatus === "pending")
    return (
      <Badge className={status}>
        <Spinner size={10} label="Extracting text" /> Extracting text
      </Badge>
    );
  if (a.extractionStatus === "failed")
    return (
      <Badge tone="bad" className={status}>
        <CrossIcon /> Extraction failed
      </Badge>
    );
  return (
    <Badge className={status}>
      <CheckIcon /> Text ready
    </Badge>
  );
}

/** One status per agreement: extraction problems first, since they block the audit, then the latest audit. */
export function LatestRun({ a }: { a: AgreementDto }) {
  if (a.extractionStatus === "pending")
    return (
      <Badge className={status}>
        <Spinner size={10} label="Extracting text" /> Extracting text
      </Badge>
    );
  if (a.extractionStatus === "failed")
    return (
      <span title={a.extractionError ?? undefined}>
        <Badge tone="bad" className={status}>
          <CrossIcon /> Extraction failed
        </Badge>
      </span>
    );
  if (runInProgress(a.latestRunStatus))
    return (
      <Badge className={status}>
        <Spinner size={10} label="Audit running" /> {runStatusLabel[a.latestRunStatus!]}
      </Badge>
    );
  if (a.latestVerdict)
    return (
      <Badge tone={verdictTone[a.latestVerdict]} className={status}>
        {verdictIcon[a.latestVerdict]} {verdictLabel[a.latestVerdict]}
      </Badge>
    );
  if (a.latestRunStatus === "failed")
    return (
      <Badge tone="bad" className={status}>
        <AlertIcon /> Audit failed
      </Badge>
    );
  return (
    <Badge className={status}>
      <MinusIcon /> Not audited
    </Badge>
  );
}

const statusFilterLabel: Record<AgreementStatusFilter, string> = {
  pass: "Pass",
  warn: "Needs review",
  fail: "Fail",
  not_audited: "Not audited",
  in_progress: "Audit running",
  audit_failed: "Audit failed",
  extracting: "Extracting text",
  extraction_failed: "Extraction failed",
};

export type AgreementSearch = Omit<AgreementListParams, "pageSize">;

/** Reads the list state from the URL; unknown values are dropped rather than failing the page. */
export function parseAgreementSearch(s: Record<string, unknown>): AgreementSearch {
  const page = Math.floor(Number(s.page));
  return {
    q: typeof s.q === "string" && s.q.trim() ? s.q : undefined,
    status: AgreementStatusFilter.safeParse(s.status).data,
    type: AgreementTypeDto.safeParse(s.type).data,
    language: LanguageDto.safeParse(s.language).data,
    page: page > 1 ? page : undefined,
  };
}

const PAGE_SIZE = 20;

export function AgreementsPage() {
  usePageTitle("Agreements");
  const me = useMe();
  const navigate = useNavigate();
  const search = parseAgreementSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState(search.q ?? "");
  const activeFilters = [search.status, search.type, search.language].filter(Boolean).length;
  // Hidden until asked for; the button's count and "Clear filters" show when a link carries filters.
  const [showFilters, setShowFilters] = useState(false);
  const page = search.page ?? 1;

  const setSearch = (next: Partial<AgreementSearch>, keepPage = false) =>
    void navigate({
      to: "/agreements",
      search: { ...search, ...next, page: keepPage ? next.page : undefined } as never,
      replace: true,
    });

  // The search box updates the URL once typing pauses.
  useEffect(() => {
    const q = draft.trim() || undefined;
    if (q === search.q) return;
    const t = setTimeout(() => setSearch({ q }), 300);
    return () => clearTimeout(t);
  });

  const list = useQuery({
    queryKey: ["agreements", search],
    queryFn: () => api.agreements({ ...search, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.anyInProgress ? 2000 : false),
  });
  const canUpload = me.data?.role !== "viewer";
  const showCosts = me.data?.role === "admin";
  const filtered = !!(search.q || search.status || search.type || search.language);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const clear = () => {
    setDraft("");
    void navigate({ to: "/agreements", search: {} as never, replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Agreements</h1>
          <p className="text-sm text-muted">Upload an agreement, then audit it against the company rules.</p>
        </div>
        {canUpload && <Button onClick={() => setUploading(true)}>Upload agreement</Button>}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div className="relative w-full sm:min-w-56 sm:flex-1">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
              <SearchIcon size={14} />
            </span>
            <Input
              type="search"
              aria-label="Search agreements"
              placeholder="Search by title or file name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button
            variant="secondary"
            aria-expanded={showFilters}
            aria-controls="agreement-filters"
            onClick={() => setShowFilters((v) => !v)}
          >
            <FilterIcon size={14} /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          {filtered && (
            <button type="button" onClick={clear} className="text-sm font-medium text-link hover:underline">
              Clear filters
            </button>
          )}
          {showFilters && (
            <div id="agreement-filters" className="flex w-full flex-wrap items-center gap-3">
              <div className="w-full sm:w-44">
                <Select
                  aria-label="Filter by status"
                  value={search.status ?? ""}
                  onChange={(e) => setSearch({ status: (e.target.value || undefined) as AgreementStatusFilter | undefined })}
                >
                  <option value="">All statuses</option>
                  {agreementStatusFilters.map((st) => (
                    <option key={st} value={st}>
                      {statusFilterLabel[st]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full sm:w-44">
                <Select
                  aria-label="Filter by type"
                  value={search.type ?? ""}
                  onChange={(e) => setSearch({ type: (e.target.value || undefined) as AgreementTypeDto | undefined })}
                >
                  <option value="">All types</option>
                  {agreementTypesDto.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="w-full sm:w-44">
                <Select
                  aria-label="Filter by language"
                  value={search.language ?? ""}
                  onChange={(e) => setSearch({ language: (e.target.value || undefined) as LanguageDto | undefined })}
                >
                  <option value="">All languages</option>
                  <option value="pl">Polish</option>
                  <option value="en">English</option>
                </Select>
              </div>
            </div>
          )}
        </div>
        {list.isPending ? (
          <SkeletonRows rows={5} />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} title="Could not load agreements" />
        ) : list.data.total === 0 ? (
          filtered ? (
            <EmptyState
              title="No agreements match"
              body="Try another search or status, or clear the filters."
              action={
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No agreements yet"
              body="Upload a PDF, DOCX, TXT or MD file. Example agreements are in seeds/agreements/files."
              action={canUpload ? <Button onClick={() => setUploading(true)}>Upload the first agreement</Button> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Audit status</th>
                    <th className="px-5 py-3 font-medium">Agreement</th>
                    {showCosts && <th className="px-5 py-3 text-right font-medium">Model cost</th>}
                    <th className="px-5 py-3 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data.items.map((a) => (
                    <tr key={a.id} className="hover:bg-canvas">
                      <td className="px-5 py-3">
                        <LatestRun a={a} />
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          to="/agreements/$agreementId"
                          params={{ agreementId: a.id }}
                          className="font-medium text-ink hover:text-link hover:underline"
                        >
                          {a.title}
                        </Link>
                        <div className="text-xs text-muted">
                          <a
                            href={`/api/v1/agreements/${a.id}/preview`}
                            target="_blank"
                            rel="noopener"
                            title="Preview the original file in a new tab"
                            className="hover:text-link hover:underline"
                          >
                            {a.fileName}
                          </a>{" "}
                          · {a.agreementType}
                        </div>
                      </td>
                      {showCosts && <td className="px-5 py-3 text-right tabular-nums">{usd(a.totalCostUsd ?? 0)}</td>}
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{relativeTime(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav
              aria-label="Pagination"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm"
            >
              <span className="text-muted">
                {list.data.items.length
                  ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + list.data.items.length} of ${list.data.total}`
                  : `No agreements on page ${page}`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setSearch({ page: page - 1 }, true)}>
                  Previous
                </Button>
                <span className="px-1 text-muted tabular-nums">
                  Page {page} of {pages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setSearch({ page: page + 1 }, true)}>
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </Card>
      <UploadDialog open={uploading} onClose={() => setUploading(false)} />
    </div>
  );
}
