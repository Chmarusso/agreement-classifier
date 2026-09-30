import { type AgreementTypeDto, agreementTypesDto, type LanguageDto, type RuleDto, type SeverityDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Select, SkeletonRows } from "../components/ui.tsx";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { severityTone } from "../lib/format.ts";
import { useMe } from "../lib/session.ts";
import { usePageTitle } from "../lib/title.ts";

const severities: SeverityDto[] = ["critical", "high", "medium", "low"];
const empty = {
  title: "",
  description: "",
  severity: "high" as SeverityDto,
  category: "",
  appliesTo: [] as AgreementTypeDto[],
  languages: [] as LanguageDto[],
};
const languageNames: Record<LanguageDto, string> = { pl: "Polish", en: "English" };
const languagesLabel = (l: LanguageDto[]) => (l.length ? l.map((x) => languageNames[x]).join(", ") : "Polish and English");

function RuleDialog({ rule, open, onClose }: { rule: RuleDto | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setForm(
        rule
          ? {
              title: rule.title,
              description: rule.description,
              severity: rule.severity,
              category: rule.category,
              appliesTo: rule.appliesTo,
              languages: rule.languages,
            }
          : empty,
      );
      setErrors({});
    }
  }, [open, rule]);

  const save = useMutation({
    mutationFn: () => (rule ? api.updateRule(rule.id, { ...form, version: rule.version }) : api.createRule(form)),
    onSuccess: (r) => {
      toast.success(rule ? `Saved "${r.title}" as version ${r.contentVersion}` : `Created "${r.title}"`);
      void qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details.length) setErrors(err.fieldErrors());
      else toast.error(errorMessage(err));
      if (err instanceof ApiError && err.code === "CONFLICT") void qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
  const toggleType = (t: AgreementTypeDto) =>
    setForm((f) => ({ ...f, appliesTo: f.appliesTo.includes(t) ? f.appliesTo.filter((x) => x !== t) : [...f.appliesTo, t] }));
  const toggleLanguage = (l: LanguageDto) =>
    setForm((f) => ({ ...f, languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l] }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={rule ? "Edit rule" : "New rule"}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Title" error={errors.title}>
          {(id) => (
            <Input id={id} value={form.title} aria-invalid={!!errors.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          )}
        </Field>
        <Field label="Requirement" error={errors.description} hint="Write it the way a lawyer would check it. The model sees this text.">
          {(id) => (
            <textarea
              id={id}
              rows={4}
              value={form.description}
              aria-invalid={!!errors.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 aria-[invalid=true]:border-danger"
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Severity" hint="Critical or high failures fail the audit.">
            {(id) => (
              <Select id={id} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as SeverityDto })}>
                {severities.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Category" error={errors.category}>
            {(id) => (
              <Input
                id={id}
                value={form.category}
                aria-invalid={!!errors.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Applies to</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {agreementTypesDto.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.appliesTo.includes(t)}
                  onChange={() => toggleType(t)}
                />
                {t}
              </label>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted">Leave all unchecked to apply to every agreement.</p>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Agreement language</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(Object.keys(languageNames) as LanguageDto[]).map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={form.languages.includes(l)}
                  onChange={() => toggleLanguage(l)}
                />
                {languageNames[l]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted">
            The language is detected when the text is extracted. Leave both unchecked to apply to Polish and English agreements.
          </p>
        </fieldset>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {rule ? "Save new version" : "Create rule"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RuleRow({ rule, canEdit, onEdit }: { rule: RuleDto; canEdit: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => (rule.status === "active" ? api.archiveRule(rule.id, rule.version) : api.restoreRule(rule.id, rule.version)),
    onSuccess: (r) => {
      toast.success(`"${r.title}" ${r.status === "active" ? "restored" : "archived"}`);
      void qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <tr className={rule.status === "archived" ? "text-muted" : undefined}>
      <td className="px-5 py-3 align-top">
        <div className="font-medium text-ink">{rule.title}</div>
        <p className="mt-0.5 max-w-xl text-sm text-muted">{rule.description}</p>
      </td>
      <td className="px-5 py-3 align-top">
        <Badge tone={severityTone[rule.severity]}>{rule.severity}</Badge>
      </td>
      <td className="px-5 py-3 align-top">{rule.category}</td>
      <td className="px-5 py-3 align-top">
        {rule.appliesTo.length ? rule.appliesTo.join(", ") : "All"}
        <span className="block text-xs text-muted">{languagesLabel(rule.languages)}</span>
      </td>
      <td className="px-5 py-3 align-top">
        v{rule.contentVersion}
        {rule.status === "archived" && (
          <span className="ml-2">
            <Badge tone="neutral">archived</Badge>
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right align-top">
        {canEdit && (
          <div className="flex justify-end gap-2">
            {rule.status === "active" && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            <Button
              variant={rule.status === "active" ? "ghost" : "secondary"}
              size="sm"
              onClick={() => toggle.mutate()}
              loading={toggle.isPending}
            >
              {rule.status === "active" ? "Archive" : "Restore"}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function RulesPage() {
  usePageTitle("Rules");
  const me = useMe();
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const [editing, setEditing] = useState<RuleDto | null>(null);
  const [open, setOpen] = useState(false);
  const canEdit = me.data?.role === "admin";
  const sorted = rules.data
    ?.slice()
    .sort((a, b) =>
      a.status === b.status ? severities.indexOf(a.severity) - severities.indexOf(b.severity) : a.status === "active" ? -1 : 1,
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Rules</h1>
          <p className="text-sm text-muted">
            What every agreement must satisfy. Edits create a new version; running audits keep the version they started with.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            New rule
          </Button>
        )}
      </div>
      <Card>
        {rules.isPending ? (
          <SkeletonRows rows={6} />
        ) : rules.error ? (
          <ErrorState error={rules.error} onRetry={() => rules.refetch()} retrying={rules.isFetching} title="Could not load rules" />
        ) : rules.data.length === 0 ? (
          <EmptyState title="No rules yet" body="Add the requirements your agreements must meet, or run `bun run seed`." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Rule</th>
                  <th className="px-5 py-3 font-medium">Severity</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Applies to</th>
                  <th className="px-5 py-3 font-medium">Version</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted?.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    canEdit={canEdit}
                    onEdit={() => {
                      setEditing(r);
                      setOpen(true);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <RuleDialog rule={editing} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
