import type { PromptSection } from "@app/domain";

export { sectionLabel } from "@app/domain";

/**
 * id: S0 (preamble), S1, S2, … or P1, P2, … for the paragraph fallback.
 * number: clause number as written, e.g. "4.2"; null for the preamble, schedule titles and paragraphs.
 * heading: clause title; sub-clauses inherit their parent's title.
 * scope: the schedule, annex or appendix the section sits in.
 * text: full section text including its heading line.
 */
export type Section = PromptSection;

/** "12. Limitation of liability": a number and a short title. */
const CLAUSE = /^(?:#{1,6}\s*)?(\d{1,3}(?:\.\d{1,3})*)[.)]?\s+(\p{Lu}[^\n]{0,90})$/u;
/** "Article 5 Scope", "§ 3 Law", "Artykuł 4 Wynagrodzenie", "Art. 2". */
const KEYWORD =
  /^(?:#{1,6}\s*)?(?:article|section|clause|§|artykuł|art\.|paragraf|rozdział)\s*(\d{1,3}(?:\.\d{1,3})*)[.:)]?\s*([^\n]{0,90})$/iu;
/** "12.3 The Supplier shall …": a numbered sub-clause paragraph of any length. */
const SUBCLAUSE = /^(?:#{1,6}\s*)?(\d{1,3}(?:\.\d{1,3})+)[.)]?\s+\S/u;
/** "Schedule 6: Special conditions", "Annex B – Pricing", "Załącznik nr 2 – Cennik". Numbering restarts inside. */
const SCHEDULE =
  /^(?:#{1,6}\s*)?((schedule|annex|appendix|exhibit|attachment|załącznik|aneks)(?:\s+nr\.?)?\s+(\d{1,2}|[A-Z]))(?![\p{L}\d])\s*[:.\-–—]?\s*([^\n]{0,90})$/iu;
/** Unnumbered blocks that real agreements set apart, such as the signature page. */
const NAMED =
  /^(?:#{1,6}\s*)?(signatures?|signature page|execution|execution page|in witness whereof|podpisy(?: stron)?)(?![\p{L}\d])[:.]?\s*$/iu;
/** Contents lines end in dot leaders or a spaced page number. */
const CONTENTS = /(?:\.{4,}|…{2,}|\s{4,})\s*\d{1,3}\s*$/u;
const MIN_HEADINGS = 3;
const PARAGRAPH_TARGET = 1200;

type Mark =
  | { kind: "clause"; number: string; heading: string | null }
  | { kind: "sub"; number: string }
  | { kind: "named"; heading: string }
  | { kind: "schedule"; scope: string; heading: string | null };

/** Looks like a title rather than the start of a sentence. */
function titleLike(heading: string, maxWords: number): boolean {
  const words = heading.split(/\s+/).filter(Boolean);
  return words.length <= maxWords && !/[.,;]$/.test(heading) && !heading.includes(",") && /^\p{Lu}/u.test(heading);
}

function classify(line: string): Mark | null {
  const t = line.trim();
  if (!t || CONTENTS.test(t)) return null;
  if (t.length <= 100) {
    const named = NAMED.exec(t);
    if (named) return { kind: "named", heading: capitalise(named[1]!) };
    const sch = SCHEDULE.exec(t);
    if (sch) {
      const rest = sch[4]!.trim();
      const separated =
        /[:.\-–—]\s*$/.test(t.slice(0, t.length - sch[4]!.length).trim()) || /^[:\-–—]/.test(t.slice(sch[1]!.length).trim());
      // "Schedule 6: Special conditions" or a bare "Schedule 6"; not "Schedule 3 and shall pay …".
      if (!rest || separated || titleLike(rest, 8))
        return { kind: "schedule", scope: `${capitalise(sch[2]!)} ${sch[3]!.toUpperCase()}`, heading: rest || null };
    }
    const m = CLAUSE.exec(t) ?? KEYWORD.exec(t);
    if (m) {
      const heading = (m[2] ?? "").trim();
      const dotted = m[1]!.includes(".");
      if (!heading || titleLike(heading, dotted ? 6 : 12)) return { kind: "clause", number: m[1]!, heading: heading || null };
    }
  }
  const sub = SUBCLAUSE.exec(t);
  if (sub) return { kind: "sub", number: sub[1]! };
  return null;
}

const capitalise = (s: string) =>
  s.charAt(0).toUpperCase() +
  s
    .slice(1)
    .toLowerCase()
    .replace(/\b([a-z])$/, (c) => c.toUpperCase());

/**
 * Keeps only markers whose numbers continue the sequence within the current
 * scope: a top-level number at most three above the current one, or a
 * sub-clause of the current one. A schedule heading resets the sequence.
 * This drops wrapped lines such as "28 GDPR." from "Article 28 GDPR".
 */
function inSequence(marks: { i: number; m: Mark }[]): { i: number; m: Mark }[] {
  const kept: { i: number; m: Mark }[] = [];
  let top = -1;
  let lastSchedule = 0;
  for (const x of marks) {
    if (x.m.kind === "named") {
      kept.push(x);
      continue;
    }
    if (x.m.kind === "schedule") {
      // Schedules come in order: 1, 2, 3 or A, B, C.
      const id = x.m.scope.split(" ")[1]!;
      const n = /^\d+$/.test(id) ? Number(id) : id.toUpperCase().charCodeAt(0) - 64;
      if (n !== lastSchedule + 1) continue;
      lastSchedule = n;
      kept.push(x);
      top = -1;
      continue;
    }
    const parts = x.m.number.split(".").map(Number);
    const first = parts[0]!;
    const ok =
      x.m.kind === "sub" ? first === top || top < 0 : top < 0 || (first > top && first <= top + 3) || (first === top && parts.length > 1);
    if (ok) {
      kept.push(x);
      top = first;
    }
  }
  return kept;
}

/**
 * Polish agreements often put the title under the number: "§ 1" then "Przedmiot umowy".
 * Taken only when a body follows, so a one-line clause is not read as its own title.
 */
function headingOnNextLine(lines: string[], at: number, end: number): string | null {
  const next = lines.slice(at + 1, end).findIndex((l) => l.trim());
  if (next < 0) return null;
  const line = lines[at + 1 + next]!.replace(/^#{1,6}\s*/, "").trim();
  const hasBody = lines.slice(at + 2 + next, end).some((l) => l.trim());
  const mark = classify(line);
  return hasBody && line.length <= 80 && titleLike(line, 6) && (!mark || mark.kind === "named") ? line : null;
}

/** Removes Markdown heading marks so every format reads the same to the model. */
const stripMarks = (t: string) => t.replace(/^#{1,6}\s*/gm, "");

export function segmentSections(text: string): Section[] {
  const lines = text.split("\n");
  const candidates = lines.map((l, i) => ({ i, m: classify(l) })).filter((x): x is { i: number; m: Mark } => x.m !== null);
  // "§ 10" followed by "Podpisy stron": the named block is the clause's title, not a section of its own.
  const marks = inSequence(candidates).filter(
    (x, k, all) =>
      !(
        x.m.kind === "named" &&
        all[k - 1]?.m.kind === "clause" &&
        !(all[k - 1]!.m as { heading: string | null }).heading &&
        lines.slice(all[k - 1]!.i + 1, x.i).every((l) => !l.trim())
      ),
  );
  if (marks.filter((x) => x.m.kind === "clause" || x.m.kind === "schedule").length < MIN_HEADINGS) return paragraphSections(text);

  const sections: Section[] = [];
  const preamble = stripMarks(lines.slice(0, marks[0]!.i).join("\n")).trim();
  if (preamble) sections.push({ id: "S0", number: null, heading: "Preamble", text: preamble, scope: null });

  let scope: string | null = null;
  let scopeHeading: string | null = null;
  let clauseHeading: string | null = null;
  marks.forEach((x, k) => {
    const end = k + 1 < marks.length ? marks[k + 1]!.i : lines.length;
    const body = stripMarks(lines.slice(x.i, end).join("\n")).trim();
    const id = `S${k + 1}`;
    if (x.m.kind === "schedule") {
      scope = x.m.scope;
      scopeHeading = x.m.heading;
      clauseHeading = null;
      sections.push({ id, number: null, heading: x.m.heading, text: body, scope });
    } else if (x.m.kind === "named") {
      clauseHeading = null;
      sections.push({ id, number: null, heading: x.m.heading, text: body, scope });
    } else if (x.m.kind === "clause") {
      clauseHeading = x.m.heading ?? headingOnNextLine(lines, x.i, end);
      sections.push({ id, number: x.m.number, heading: clauseHeading, text: body, scope });
    } else {
      sections.push({ id, number: x.m.number, heading: clauseHeading ?? scopeHeading, text: body, scope });
    }
  });
  return sections;
}

/** Fallback for documents without numbered headings: blank-line paragraphs, merged to a readable size. */
function paragraphSections(text: string): Section[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Section[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ id: `P${out.length + 1}`, number: null, heading: null, text: buf, scope: null });
    buf = "";
  };
  for (const p of paragraphs) {
    if (buf && buf.length + p.length > PARAGRAPH_TARGET) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return out.length ? out : [{ id: "P1", number: null, heading: null, text, scope: null }];
}
