import { type AgreementLanguage, type AnonymizationConfig, anonymizationLabels } from "@app/domain";

/**
 * Client for the local anonymizer service (apps/anonymizer). Personal data is
 * replaced with placeholders such as <PERSON_1> before any text reaches a model;
 * the mapping stays in Postgres and is used only to show reports to people.
 */

export interface AnonymizedEntity {
  placeholder: string;
  label: string;
  value: string;
  count: number;
  /** Every surface form replaced by this placeholder, such as inflected Polish names. */
  variants: string[];
}

export interface AnonymizationResult {
  text: string;
  language: AgreementLanguage;
  engine: string;
  entities: AnonymizedEntity[];
}

export interface AnonymizeOptions {
  language?: AgreementLanguage;
  /** The admin's settings; without them the service runs every technique. */
  config?: AnonymizationConfig | null;
}

export interface Anonymizer {
  readonly label: string;
  anonymize(text: string, opts?: AnonymizeOptions): Promise<AnonymizationResult>;
}

export interface AnonymizerHealth {
  ok: boolean;
  engine: string;
  ner: boolean;
  labels: string[];
  /** Installed NER models per language, and the ones the service uses by default. */
  nerModels: Record<string, string[]>;
  nerDefaultModels: Record<string, string>;
}

/** The service's request options for a settings object. */
export function serviceOptions(config: AnonymizationConfig): Record<string, unknown> {
  const disabled = new Set<string>(config.disabledLabels);
  return {
    labels: disabled.size ? anonymizationLabels.filter((l) => !disabled.has(l)) : null,
    person_cues: config.personCues,
    propagate: config.propagate,
    inflection: config.inflection,
    ner: config.ner,
    ner_models: Object.fromEntries(Object.entries(config.nerModels).filter(([, m]) => m)),
  };
}

export class AnonymizerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnonymizerUnavailableError";
  }
}

export class HttpAnonymizer implements Anonymizer {
  readonly label: string;

  constructor(
    readonly url: string,
    private readonly opts: { keep?: string[]; timeoutMs?: number } = {},
  ) {
    this.label = `anonymizer@${new URL(url).host}`;
  }

  async health(): Promise<AnonymizerHealth> {
    const res = await this.fetch("/health", { method: "GET" });
    const body = (await res.json()) as {
      ok: boolean;
      engine: string;
      ner: boolean;
      labels?: string[];
      ner_models?: Record<string, string[]>;
      ner_default_models?: Record<string, string>;
    };
    return {
      ok: body.ok,
      engine: body.engine,
      ner: body.ner,
      labels: body.labels ?? [],
      nerModels: body.ner_models ?? {},
      nerDefaultModels: body.ner_default_models ?? {},
    };
  }

  async anonymize(text: string, opts: AnonymizeOptions = {}): Promise<AnonymizationResult> {
    const config = opts.config ?? null;
    const res = await this.fetch("/anonymize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        language: opts.language ?? null,
        // Settings replace the environment keep list once an admin has saved them.
        keep: config ? config.keep : (this.opts.keep ?? []),
        ...(config ? { options: serviceOptions(config) } : {}),
      }),
    });
    const body = (await res.json()) as AnonymizationResult & { spans?: unknown };
    if (typeof body.text !== "string" || !Array.isArray(body.entities))
      throw new AnonymizerUnavailableError("The anonymizer returned an unexpected answer.");
    return { text: body.text, language: body.language, engine: body.engine, entities: body.entities };
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.url), { ...init, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000) });
    } catch (err) {
      throw new AnonymizerUnavailableError(`The anonymizer at ${this.url} is not reachable: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) throw new AnonymizerUnavailableError(`The anonymizer answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

/** ANONYMIZER_URL turns anonymization on; ANONYMIZER_KEEP lists terms, separated by ";", that stay readable (the company's own name). */
export function anonymizerFromEnv(env: Record<string, string | undefined>): HttpAnonymizer | null {
  const url = env.ANONYMIZER_URL?.trim();
  if (!url) return null;
  const keep = (env.ANONYMIZER_KEEP ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return new HttpAnonymizer(url, { keep, timeoutMs: Number(env.ANONYMIZER_TIMEOUT_MS ?? 60_000) });
}

export const PLACEHOLDER = /<([A-Z][A-Z_]*)_(\d+)>/g;

/** Puts the original values back. Unknown placeholders are left as they are. */
export function rehydrate(text: string, entities: Pick<AnonymizedEntity, "placeholder" | "value">[]): string {
  if (!entities.length) return text;
  const byPlaceholder = new Map(entities.map((e) => [e.placeholder, e.value]));
  return text.replace(PLACEHOLDER, (m) => byPlaceholder.get(m) ?? m);
}

/** rehydrate applied to every string inside a JSON-like value. */
export function rehydrateDeep<T>(value: T, entities: Pick<AnonymizedEntity, "placeholder" | "value">[]): T {
  if (!entities.length) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rehydrate(v, entities);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export function entityCounts(entities: Pick<AnonymizedEntity, "label">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.label] = (counts[e.label] ?? 0) + 1;
  return counts;
}

/** Values that must never appear in text sent to a model. Used by tests and as a last check before a call. */
export function leakedValues(text: string, entities: Pick<AnonymizedEntity, "variants" | "value">[]): string[] {
  const lower = text.toLowerCase();
  return [...new Set(entities.flatMap((e) => [e.value, ...e.variants]))].filter((v) => v.length >= 3 && lower.includes(v.toLowerCase()));
}

/** Replaces known values with their placeholders in text the service did not see, such as the agreement title. */
export function applyPlaceholders(text: string, entities: Pick<AnonymizedEntity, "placeholder" | "value" | "variants">[]): string {
  const pairs = entities
    .flatMap((e) => [e.value, ...e.variants].map((v) => [v, e.placeholder] as const))
    .filter(([v]) => v.length >= 3)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [value, placeholder] of pairs) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`, "giu"), placeholder);
  }
  return out;
}
