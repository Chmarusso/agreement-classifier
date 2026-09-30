import type { AnonymizedEntityDto, TextViewDto } from "@app/contracts";
import type { ReactNode } from "react";
import { cx } from "./ui.tsx";

const PLACEHOLDER = /<[A-Z][A-Z_]*_\d+>/g;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Marks personal data in the original text, or the placeholders in the text sent to the model.
 * Hovering a mark shows its counterpart, so both views can be checked against each other.
 */
export function highlightEntities(text: string, entities: AnonymizedEntityDto[], view: TextViewDto): ReactNode[] {
  if (!entities.length) return [text];
  let pattern: RegExp;
  let lookup: (match: string) => AnonymizedEntityDto | undefined;
  if (view === "anonymized") {
    const byPlaceholder = new Map(entities.map((e) => [e.placeholder, e]));
    pattern = PLACEHOLDER;
    lookup = (m) => byPlaceholder.get(m);
  } else {
    const byValue = new Map<string, AnonymizedEntityDto>();
    for (const e of entities) for (const v of [e.value, ...e.variants]) byValue.set(v.toLowerCase(), e);
    const values = [...byValue.keys()].filter((v) => v.length >= 2).sort((a, b) => b.length - a.length);
    if (!values.length) return [text];
    pattern = new RegExp(`(?<![\\p{L}\\d])(?:${values.map(escapeRegExp).join("|")})(?![\\p{L}\\d])`, "giu");
    lookup = (m) => byValue.get(m.toLowerCase());
  }
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const entity = lookup(m[0]);
    if (!entity) continue;
    out.push(text.slice(last, m.index));
    out.push(
      <mark
        key={m.index}
        title={view === "anonymized" ? `${entity.label}: ${entity.value}` : `Sent as ${entity.placeholder}`}
        className={cx("rounded px-0.5", view === "anonymized" ? "bg-brand/10 font-mono text-[0.85em] text-brand" : "bg-warn-soft text-ink")}
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function TextViewToggle({
  view,
  onChange,
  anonymizedLabel = "Sent to model",
}: {
  view: TextViewDto;
  onChange: (v: TextViewDto) => void;
  anonymizedLabel?: string;
}) {
  const options: [TextViewDto, string][] = [
    ["original", "Original"],
    ["anonymized", anonymizedLabel],
  ];
  return (
    <fieldset aria-label="Text version" className="inline-flex rounded-md border border-line bg-canvas p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cx("rounded px-3 py-1 font-medium", view === v ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

export function EntityTable({ entities }: { entities: AnonymizedEntityDto[] }) {
  if (!entities.length) return <p className="px-4 py-3 text-sm text-muted">No personal data was found.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="px-4 py-2 font-medium">Sent as</th>
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Original value</th>
          <th className="px-4 py-2 text-right font-medium">Occurrences</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {entities.map((e) => (
          <tr key={e.placeholder}>
            <td className="px-4 py-2 font-mono text-xs text-brand">{e.placeholder}</td>
            <td className="px-4 py-2 text-muted">{e.label}</td>
            <td className="px-4 py-2">
              {e.value}
              {e.variants.filter((v) => v !== e.value).length > 0 && (
                <span className="block text-xs text-muted">also: {e.variants.filter((v) => v !== e.value).join(", ")}</span>
              )}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{e.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const languageLabel = { pl: "Polish", en: "English" } as const;
