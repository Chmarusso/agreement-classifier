import type { AnonymizationConfigDto, AnonymizationPreviewDto, AnonymizationSettingsDto } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { EntityTable, highlightEntities, languageLabel } from "../components/AnonymizedText.tsx";
import { AlertIcon, CheckIcon, ShieldIcon } from "../components/icons.tsx";
import { Badge, Button, Card, ErrorState, PageSpinner, Select } from "../components/ui.tsx";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { usePageTitle } from "../lib/title.ts";

/** Entity types in groups an admin recognises. Types the service adds later show under "Other". */
const LABEL_GROUPS: { title: string; labels: Record<string, string> }[] = [
  {
    title: "Polish identifiers",
    labels: { PESEL: "PESEL", NIP: "NIP", REGON: "REGON", KRS: "KRS", ID_CARD: "ID card", LAND_REGISTER: "Land register (KW)" },
  },
  {
    title: "Other identifiers",
    labels: { PASSPORT: "Passport", SSN: "US SSN", NI_NUMBER: "UK NI number", VAT_ID: "EU VAT number", COMPANY_NO: "UK company number" },
  },
  { title: "Financial", labels: { IBAN: "IBAN", BANK_ACCOUNT: "Polish account number", CARD: "Payment card" } },
  { title: "Contact and location", labels: { EMAIL: "E-mail", PHONE: "Phone", ADDRESS: "Address", DATE_OF_BIRTH: "Date of birth" } },
  { title: "People and companies", labels: { PERSON: "People", ORG: "Companies" } },
];

const TECHNIQUES: { key: "personCues" | "propagate" | "inflection" | "ner"; title: string; body: string }[] = [
  {
    key: "personCues",
    title: "Names from cue phrases",
    body: "Finds people after words such as “Name:”, “represented by”, “reprezentowana przez”, “Pani” or “zamieszkały”.",
  },
  {
    key: "propagate",
    title: "Later mentions",
    body: "Replaces every later mention of a name or company already found, such as “Mr Smith” or a company without its legal form.",
  },
  {
    key: "inflection",
    title: "Polish case forms",
    body: "Links Polish case forms of one name, so Anna Kowalska, Annę Kowalską and Annie Kowalskiej share one placeholder.",
  },
  {
    key: "ner",
    title: "NER model (spaCy)",
    body: "A local language model that also finds names and companies without cue words. Slower, and it can mark ordinary words.",
  },
];

const SAMPLE = `Umowa zawarta w Warszawie pomiędzy Northwind Analytics sp. z o.o., reprezentowaną przez Annę Kowalską – Prezesa Zarządu, a Panią Katarzyną Zając, PESEL 92031507849, zamieszkałą w Krakowie, ul. Floriańska 20/4, 31-021 Kraków, e-mail k.zajac@poczta.example, tel. 600-700-800.
Wynagrodzenie płatne na rachunek PL81 1050 1445 1000 0022 7463 5201. Korespondencję do Katarzyny Zając kieruje się na adres e-mail.
The Consultant, John Smith of Acme Consulting Ltd (company number 01234567), may be reached at +44 20 7946 0958. Mr Smith signs for Acme.`;

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-brand" : "bg-line"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card title={title}>
      {hint && <p className="px-5 pt-4 text-sm text-muted">{hint}</p>}
      <div className="p-5">{children}</div>
    </Card>
  );
}

export function AnonymizationSettingsPage() {
  usePageTitle("Anonymization");
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["anonymization-settings"], queryFn: api.anonymizationSettings });
  const [draft, setDraft] = useState<AnonymizationConfigDto | null>(null);
  const [keepText, setKeepText] = useState("");
  const [sample, setSample] = useState(SAMPLE);
  const [preview, setPreview] = useState<AnonymizationPreviewDto | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = (s: AnonymizationSettingsDto) => {
    setDraft(s.config);
    setKeepText(s.config.keep.join("\n"));
    setErrors({});
  };
  useEffect(() => {
    if (settings.data && !draft) load(settings.data);
  }, [settings.data, draft]);

  const config: AnonymizationConfigDto | null = draft && {
    ...draft,
    keep: keepText
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean),
  };
  const dirty = !!config && !!settings.data && JSON.stringify(config) !== JSON.stringify(settings.data.config);

  const onSaved = (s: AnonymizationSettingsDto, msg: string) => {
    qc.setQueryData(["anonymization-settings"], s);
    load(s);
    toast.success(msg);
  };
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.details.length) setErrors(err.fieldErrors());
    toast.error(errorMessage(err));
    if (err instanceof ApiError && err.code === "CONFLICT") void settings.refetch();
  };
  const save = useMutation({
    mutationFn: () => api.saveAnonymizationSettings(config!, settings.data!.version),
    onSuccess: (s) => onSaved(s, "Anonymization settings saved. New uploads use them."),
    onError,
  });
  const reset = useMutation({
    mutationFn: () => api.resetAnonymizationSettings(settings.data!.version),
    onSuccess: (s) => onSaved(s, "Anonymization reset to the defaults"),
    onError,
  });
  const runPreview = useMutation({
    mutationFn: () => api.previewAnonymization(sample, config!),
    onSuccess: setPreview,
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (settings.isPending) return <PageSpinner label="Loading anonymization settings" />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} title="Could not load the settings" />;
  if (!draft || !config) return null;
  const s = settings.data;
  const svc = s.service;
  const nerInstalled = Object.values(svc.nerModels).some((m) => m.length > 0);
  const set = <K extends keyof AnonymizationConfigDto>(k: K, v: AnonymizationConfigDto[K]) => setDraft({ ...draft, [k]: v });
  const disabled = new Set(draft.disabledLabels);
  const toggleLabel = (label: string, on: boolean) =>
    set("disabledLabels", on ? draft.disabledLabels.filter((l) => l !== label) : [...draft.disabledLabels, label]);
  const known = new Set(LABEL_GROUPS.flatMap((g) => Object.keys(g.labels)));
  const groups = [
    ...LABEL_GROUPS,
    { title: "Other", labels: Object.fromEntries(s.labels.filter((l) => !known.has(l)).map((l) => [l, l])) },
  ].filter((g) => Object.keys(g.labels).length);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Anonymization <Badge tone={s.isDefault ? "neutral" : "brand"}>{s.isDefault ? "Defaults" : "Custom settings"}</Badge>
          </h2>
          <p className="text-sm text-muted">
            What is replaced with placeholders before agreement text reaches the model. Changes apply to agreements uploaded afterwards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
          {!s.isDefault && (
            <Button variant="ghost" onClick={() => reset.mutate()} loading={reset.isPending}>
              Reset to defaults
            </Button>
          )}
          <Button variant="secondary" onClick={() => load(s)} disabled={!dirty}>
            Discard
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
          {svc.reachable ? (
            <>
              <Badge tone="good">
                <CheckIcon /> Service running
              </Badge>
              <span className="text-muted">
                {svc.url} · engine <span className="font-mono text-ink">{svc.engine}</span> ·{" "}
                {nerInstalled ? "NER models installed" : "no NER models installed (rules only)"}
              </span>
            </>
          ) : (
            <>
              <Badge tone="bad">
                <AlertIcon /> Service not available
              </Badge>
              <span className="text-muted">{svc.error}</span>
            </>
          )}
        </div>
      </Card>

      <Section title="Techniques">
        <ul className="flex flex-col divide-y divide-line">
          {TECHNIQUES.map((t) => {
            const unavailable = t.key === "ner" && !nerInstalled;
            return (
              <li key={t.key} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                <Toggle label={t.title} checked={draft[t.key] && !unavailable} onChange={(v) => set(t.key, v)} disabled={unavailable} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-sm text-muted">{t.body}</p>
                  {unavailable && (
                    <p className="mt-1 text-xs text-warn">
                      Not installed on the anonymizer. Build its image with ANONYMIZER_WITH_NER=1 to add spaCy with Polish and English
                      models.
                    </p>
                  )}
                  {t.key === "ner" && nerInstalled && draft.ner && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(["pl", "en"] as const).map((lang) => (
                        <label key={lang} htmlFor={`ner-model-${lang}`} className="flex flex-col gap-1 text-sm">
                          <span className="text-muted">{languageLabel[lang]} model</span>
                          <Select
                            id={`ner-model-${lang}`}
                            value={draft.nerModels[lang] ?? ""}
                            onChange={(e) => set("nerModels", { ...draft.nerModels, [lang]: e.target.value || null })}
                          >
                            <option value="">Service default ({svc.nerDefaultModels[lang] ?? "none"})</option>
                            {(svc.nerModels[lang] ?? []).map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </Select>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
          Checksum-validated identifiers (PESEL, NIP, IBAN …), e-mails, phones, addresses and companies by legal form are always detected by
          rules; switch individual types off below.
        </p>
      </Section>

      <Section title="What to replace" hint="Unchecked types stay readable in the text sent to the model.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <fieldset key={g.title}>
              <legend className="text-xs font-medium uppercase tracking-wide text-muted">{g.title}</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {Object.entries(g.labels).map(([label, name]) => (
                  <label key={label} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={!disabled.has(label)}
                      onChange={(e) => toggleLabel(label, e.target.checked)}
                    />
                    {name}
                    <span className="font-mono text-[11px] text-muted">{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {errors["disabledLabels.0"] && <p className="mt-2 text-sm text-danger">{errors["disabledLabels.0"]}</p>}
      </Section>

      <Section
        title="Never replace"
        hint="One per line, for example the company's own name, so the model knows which party is the Company."
      >
        <textarea
          aria-label="Terms that are never replaced"
          rows={4}
          value={keepText}
          onChange={(e) => setKeepText(e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        {Object.entries(errors)
          .filter(([k]) => k.startsWith("keep"))
          .map(([k, v]) => (
            <p key={k} className="mt-1 text-sm text-danger">
              Line {Number(k.split(".")[1] ?? 0) + 1}: {v}
            </p>
          ))}
      </Section>

      <Section title="Try it" hint="Runs the settings on this page, saved or not, on your own text. Nothing is stored or sent to a model.">
        <textarea
          aria-label="Sample text"
          rows={6}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => runPreview.mutate()} loading={runPreview.isPending} disabled={!svc.reachable || !sample.trim()}>
            <ShieldIcon size={14} /> Preview anonymization
          </Button>
          {preview && (
            <span className="text-sm text-muted">
              {preview.entities.length} items replaced · {languageLabel[preview.language]} · {preview.engine}
            </span>
          )}
        </div>
        {preview && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-line">
              <p className="border-b border-line bg-canvas px-4 py-2 text-xs text-muted">Sent to the model</p>
              <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">
                {highlightEntities(preview.text, preview.entities, "anonymized")}
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-line">
              <EntityTable entities={preview.entities} />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
