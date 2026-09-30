import type { AuditLogEntryDto, AuditLogPage as Page } from "@app/contracts";
import { type InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, formatTime, Input, Select, SkeletonRows } from "../components/ui.tsx";
import { type AuditLogFilters, api } from "../lib/api.ts";
import { usePageTitle } from "../lib/title.ts";

const tone = (type: string): "good" | "bad" | "warn" | "brand" | "neutral" => {
  if (/Failed|Rejected|Stalled|Deactivated/.test(type)) return "bad";
  if (/Verified|Completed|Reactivated/.test(type)) return "good";
  if (/Viewed|Downloaded/.test(type)) return "neutral";
  if (/Worker|Bridge/.test(type)) return "warn";
  return "brand";
};

function matches(e: AuditLogEntryDto, f: AuditLogFilters): boolean {
  if (f.eventType && e.eventType !== f.eventType) return false;
  if (f.streamType && e.streamType !== f.streamType) return false;
  if (f.actorId && e.actorId !== f.actorId) return false;
  if (!f.includeReads && e.isRead) return false;
  if (f.from && new Date(e.occurredAt) < new Date(f.from)) return false;
  if (f.to && new Date(e.occurredAt) > new Date(f.to)) return false;
  return true;
}

type LiveState = "off" | "connecting" | "live" | "reconnecting";

/** Streams new entries over SSE into the first page; falls back to polling while disconnected. */
function useLiveTail(enabled: boolean, filters: AuditLogFilters, queryKey: unknown[]): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>("off");
  useEffect(() => {
    if (!enabled) {
      setState("off");
      return;
    }
    setState("connecting");
    const es = new EventSource(`/api/v1/audit-log/stream${filters.includeReads ? "?includeReads=true" : ""}`);
    es.addEventListener("ready", () => setState("live"));
    es.addEventListener("audit", (msg) => {
      const entry = JSON.parse((msg as MessageEvent<string>).data) as AuditLogEntryDto;
      if (!matches(entry, filters)) return;
      qc.setQueryData<InfiniteData<Page, number | null>>(queryKey, (old) => {
        if (!old?.pages[0] || old.pages[0].items.some((i) => i.eventId === entry.eventId)) return old;
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [entry, ...first.items] }, ...rest] };
      });
    });
    es.onerror = () => setState("reconnecting");
    return () => es.close();
  }, [enabled, filters, queryKey, qc]);
  return state;
}

export function AuditLogPage() {
  usePageTitle("Audit log");
  const [draft, setDraft] = useState<AuditLogFilters>({});
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<AuditLogEntryDto | null>(null);

  const queryKey = useMemo(() => ["audit-log", filters], [filters]);
  const liveState = useLiveTail(live, filters, queryKey);

  const log = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.auditLog(filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
    // Poll only while live mode is on but the stream is down.
    refetchInterval: live && liveState === "reconnecting" ? 3000 : false,
  });
  const types = useQuery({ queryKey: ["event-types"], queryFn: api.eventTypes, staleTime: Number.POSITIVE_INFINITY });
  const actors = useQuery({ queryKey: ["audit-actors"], queryFn: api.auditActors, staleTime: 60_000 });

  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof AuditLogFilters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value || undefined }));
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-muted">Every action in the system, newest first.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="h-4 w-4 accent-brand" />
          Live tail
          {live && (
            <Badge tone={liveState === "live" ? "good" : liveState === "reconnecting" ? "warn" : "neutral"}>
              {liveState === "live" ? "live" : liveState === "reconnecting" ? "reconnecting… polling every 3 s" : "connecting…"}
            </Badge>
          )}
        </label>
      </div>

      <Card>
        <form
          className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...draft });
          }}
        >
          <Field label="From">{(id) => <Input id={id} type="datetime-local" value={draft.from ?? ""} onChange={set("from")} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="datetime-local" value={draft.to ?? ""} onChange={set("to")} />}</Field>
          <Field label="Event type">
            {(id) => (
              <Select id={id} value={draft.eventType ?? ""} onChange={set("eventType")} disabled={types.isPending}>
                <option value="">{types.isPending ? "Loading…" : "All event types"}</option>
                {types.data?.eventTypes.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.type}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Entity type">
            {(id) => (
              <Select id={id} value={draft.streamType ?? ""} onChange={set("streamType")} disabled={types.isPending}>
                <option value="">All entities</option>
                {types.data?.streamTypes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Actor">
            {(id) => (
              <Select id={id} value={draft.actorId ?? ""} onChange={set("actorId")} disabled={actors.isPending}>
                <option value="">{actors.isPending ? "Loading…" : "Anyone"}</option>
                {actors.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={!!draft.includeReads}
              onChange={(e) => setDraft((d) => ({ ...d, includeReads: e.target.checked || undefined }))}
            />
            Show read events
          </label>
          <div className="flex items-end gap-2 lg:col-span-2 lg:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft({});
                setFilters({});
              }}
            >
              Clear
            </Button>
            <Button type="submit" loading={log.isFetching && !log.isFetchingNextPage && !log.isPending && activeCount > 0}>
              Apply filters
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {log.isPending ? (
          <SkeletonRows rows={8} />
        ) : !log.data ? (
          <ErrorState error={log.error} onRetry={() => log.refetch()} retrying={log.isFetching} title="Could not load the audit log" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No events match"
            body={activeCount ? "Try widening the date range or clearing filters." : "Nothing has happened yet."}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Time</th>
                    <th className="px-5 py-3 font-medium">Actor</th>
                    <th className="px-5 py-3 font-medium">Event</th>
                    <th className="px-5 py-3 font-medium">What happened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((e) => (
                    <tr
                      key={e.eventId}
                      tabIndex={0}
                      onClick={() => setSelected(e)}
                      onKeyDown={(k) => k.key === "Enter" && setSelected(e)}
                      className="cursor-pointer hover:bg-canvas focus:bg-canvas focus:outline-none"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-muted tabular-nums">{formatTime(e.occurredAt)}</td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {e.actorLabel}
                        {e.actorType !== "user" && e.actorLabel !== e.actorType && (
                          <span className="ml-1 text-xs text-muted">({e.actorType})</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <Badge tone={tone(e.eventType)}>{e.eventType}</Badge>
                      </td>
                      <td className="px-5 py-3">{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
              <span>{items.length} events shown</span>
              {log.hasNextPage ? (
                <Button variant="secondary" size="sm" onClick={() => log.fetchNextPage()} loading={log.isFetchingNextPage}>
                  Load older events
                </Button>
              ) : (
                <span>End of log</span>
              )}
            </div>
            {log.isFetchNextPageError && (
              <ErrorState
                error={log.error}
                onRetry={() => log.fetchNextPage()}
                retrying={log.isFetchingNextPage}
                title="Could not load older events"
              />
            )}
          </>
        )}
      </Card>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.eventType ?? ""}>
        {selected && (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Summary</dt>
            <dd>{selected.summary}</dd>
            <dt className="text-muted">When</dt>
            <dd>{formatTime(selected.occurredAt)}</dd>
            <dt className="text-muted">Actor</dt>
            <dd>
              {selected.actorLabel} <span className="text-muted">({selected.actorType})</span>
            </dd>
            <dt className="text-muted">Entity</dt>
            <dd>
              {selected.streamType} {selected.entityLabel && <>· {selected.entityLabel}</>}
              <div className="font-mono text-xs text-muted">{selected.streamId}</div>
            </dd>
            <dt className="text-muted">Event id</dt>
            <dd className="font-mono text-xs">{selected.eventId}</dd>
            <dt className="text-muted">Payload</dt>
            <dd>
              <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs">{JSON.stringify(selected.payload, null, 2)}</pre>
            </dd>
            <dt className="text-muted">Metadata</dt>
            <dd>
              <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs">{JSON.stringify(selected.metadata, null, 2)}</pre>
            </dd>
          </dl>
        )}
      </Drawer>
    </div>
  );
}
