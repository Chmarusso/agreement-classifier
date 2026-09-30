import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { type Fixture, fileNameFor, fixtures } from "./agreements.ts";

export const agreementsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agreements");

type Block = { kind: "h1" | "h2" | "p"; text: string };

function blocks(markdown: string): Block[] {
  return markdown.split(/\n{2,}/).flatMap((chunk): Block[] => {
    const lines = chunk.split("\n");
    const first = lines[0]!;
    if (first.startsWith("# ")) return [{ kind: "h1", text: first.slice(2) }];
    if (first.startsWith("## ")) {
      const rest = lines.slice(1).join("\n").trim();
      return rest
        ? [
            { kind: "h2", text: first.slice(3) },
            { kind: "p", text: rest },
          ]
        : [{ kind: "h2", text: first.slice(3) }];
    }
    return [{ kind: "p", text: chunk }];
  });
}

/** Standard 14 fonts only encode WinAnsi; map Polish letters to ASCII for the PDF text layer. */
const winAnsi = (s: string) =>
  s.replace(
    /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g,
    (c) =>
      ({
        ą: "a",
        ć: "c",
        ę: "e",
        ł: "l",
        ń: "n",
        ó: "o",
        ś: "s",
        ź: "z",
        ż: "z",
        Ą: "A",
        Ć: "C",
        Ę: "E",
        Ł: "L",
        Ń: "N",
        Ó: "O",
        Ś: "S",
        Ź: "Z",
        Ż: "Z",
      })[c] ?? c,
  );

async function renderPdf(markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const [W, H, M] = [595, 842, 60];
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const write = (text: string, font = regular, size = 11, gapAfter = 6) => {
    for (const para of winAnsi(text).split("\n")) {
      const words = para.split(" ");
      let line = "";
      const flush = () => {
        if (y < M) {
          page = pdf.addPage([W, H]);
          y = H - M;
        }
        page.drawText(line, { x: M, y, size, font, color: rgb(0.1, 0.1, 0.1) });
        y -= size * 1.35;
        line = "";
      };
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) > W - 2 * M) {
          flush();
          line = w;
        } else line = next;
      }
      if (line) flush();
    }
    y -= gapAfter;
  };
  for (const b of blocks(markdown)) {
    if (b.kind === "h1") write(b.text, bold, 16, 10);
    else if (b.kind === "h2") write(b.text, bold, 12, 2);
    else write(b.text);
  }
  return pdf.save();
}

// ---------- Real-length layout ----------

type LongBlock =
  | { kind: "title"; text: string }
  | { kind: "clause"; text: string }
  | { kind: "schedule"; text: string }
  | { kind: "para"; text: string }
  | { kind: "table"; rows: string[][] };

function longBlocks(markdown: string): LongBlock[] {
  const out: LongBlock[] = [];
  for (const chunk of markdown.split(/\n{2,}/)) {
    const first = chunk.split("\n")[0]!;
    if (first.startsWith("# Schedule")) out.push({ kind: "schedule", text: first.slice(2) });
    else if (first.startsWith("# ")) out.push({ kind: "title", text: first.slice(2) });
    else if (first.startsWith("## ")) {
      out.push({ kind: "clause", text: first.slice(3) });
      const rest = chunk.split("\n").slice(1).join("\n").trim();
      if (rest) out.push({ kind: "para", text: rest });
    } else if (first.startsWith("|")) {
      const rows = chunk
        .split("\n")
        .filter((l) => !/^\|\s*-{3}/.test(l))
        .map((l) =>
          l
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim()),
        );
      out.push({ kind: "table", rows });
    } else out.push({ kind: "para", text: chunk });
  }
  return out;
}

/**
 * Renders a long agreement the way real contracts look: title page with a
 * contents list (dot leaders and page numbers), running header, "Page X of Y"
 * footer, 11pt body, tables, and each schedule starting on a new page.
 * Layout runs twice so the contents list shows real page numbers.
 */
async function renderLongPdf(markdown: string): Promise<Uint8Array> {
  const blocks = longBlocks(markdown);
  const title = blocks.find((b) => b.kind === "title")?.text ?? "Agreement";
  const headings = blocks.filter((b) => b.kind === "clause" || b.kind === "schedule").map((b) => (b as { text: string }).text);

  const layout = async (tocPages: Map<string, number>) => {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.TimesRoman);
    const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
    const [W, H, M] = [595, 842, 72];
    const pages: ReturnType<typeof pdf.addPage>[] = [];
    let page = pdf.addPage([W, H]);
    pages.push(page);
    let y = H - M;
    const seen = new Map<string, number>();
    const newPage = () => {
      page = pdf.addPage([W, H]);
      pages.push(page);
      y = H - M;
    };
    const ensure = (h: number) => {
      if (y - h < M) newPage();
    };
    const wrap = (text: string, font: typeof regular, size: number, width: number) => {
      const lines: string[] = [];
      for (const para of winAnsi(text).split("\n")) {
        let line = "";
        for (const w of para.split(" ")) {
          const next = line ? `${line} ${w}` : w;
          if (font.widthOfTextAtSize(next, size) > width && line) {
            lines.push(line);
            line = w;
          } else line = next;
        }
        lines.push(line);
      }
      return lines;
    };
    const write = (text: string, font = regular, size = 11, gap = 7, indent = 0) => {
      for (const line of wrap(text, font, size, W - 2 * M - indent)) {
        ensure(size * 1.4);
        page.drawText(line, { x: M + indent, y, size, font, color: rgb(0.1, 0.1, 0.1) });
        y -= size * 1.4;
      }
      y -= gap;
    };

    // Title page with contents.
    write(title.toUpperCase(), bold, 18, 16);
    write("Contents", bold, 12, 6);
    for (const h of headings) {
      const pageNo = String(tocPages.get(h) ?? 0);
      const label = winAnsi(h);
      const size = 10.5;
      const room = W - 2 * M - regular.widthOfTextAtSize(`${label} ${pageNo}`, size);
      const dots = ".".repeat(Math.max(3, Math.floor(room / regular.widthOfTextAtSize(".", size)) - 2));
      ensure(size * 1.5);
      page.drawText(`${label} ${dots} ${pageNo}`, { x: M, y, size, font: regular });
      y -= size * 1.5;
    }
    newPage();

    for (const b of blocks) {
      switch (b.kind) {
        case "title":
          write(b.text, bold, 15, 10);
          break;
        case "schedule":
          newPage();
          seen.set(b.text, pages.length);
          write(b.text, bold, 14, 10);
          break;
        case "clause":
          ensure(60);
          seen.set(b.text, pages.length);
          write(b.text, bold, 12, 4);
          break;
        case "para":
          write(b.text);
          break;
        case "table": {
          const cols = b.rows[0]!.length;
          const colW = (W - 2 * M) / cols;
          b.rows.forEach((row, r) => {
            const cells = row.map((c) => wrap(c, r === 0 ? bold : regular, 9.5, colW - 6));
            const h = Math.max(...cells.map((c) => c.length)) * 9.5 * 1.3 + 4;
            ensure(h);
            for (const [c, lines] of cells.entries()) {
              for (const [i, l] of lines.entries()) {
                page.drawText(l, { x: M + c * colW, y: y - i * 9.5 * 1.3, size: 9.5, font: r === 0 ? bold : regular });
              }
            }
            y -= h;
          });
          y -= 8;
          break;
        }
      }
    }

    // Running header (not on the title page) and footer on every page.
    const total = pages.length;
    pages.forEach((pg, i) => {
      if (i > 0) pg.drawText(winAnsi(`${title} | Confidential`), { x: M, y: H - 40, size: 8.5, font: italic, color: rgb(0.4, 0.4, 0.4) });
      const footer = `Page ${i + 1} of ${total}`;
      pg.drawText(footer, {
        x: (W - regular.widthOfTextAtSize(footer, 8.5)) / 2,
        y: 36,
        size: 8.5,
        font: regular,
        color: rgb(0.4, 0.4, 0.4),
      });
    });
    return { pdf, seen, total };
  };

  const first = await layout(new Map());
  const second = await layout(first.seen);
  return second.pdf.save();
}

/** A page of grey bars that looks like a scan but has no text layer. */
async function renderScannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let p = 0; p < 2; p++) {
    const page = pdf.addPage([595, 842]);
    for (let i = 0; i < 38; i++) {
      const width = 380 + ((i * 37) % 95);
      page.drawRectangle({ x: 60, y: 780 - i * 19, width, height: 7, color: rgb(0.55, 0.55, 0.55) });
    }
  }
  return pdf.save();
}

async function renderDocx(markdown: string): Promise<Uint8Array> {
  const children = blocks(markdown).flatMap((b) => {
    if (b.kind === "h1") return [new Paragraph({ text: b.text, heading: HeadingLevel.TITLE })];
    if (b.kind === "h2") return [new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 })];
    return b.text.split("\n").map((line) => new Paragraph({ children: [new TextRun(line)] }));
  });
  const doc = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const toPlainText = (markdown: string) => markdown.replace(/^# (.*)$/m, (_, t: string) => t.toUpperCase()).replace(/^## /gm, "");

export async function renderFixture(f: Fixture): Promise<Uint8Array> {
  switch (f.format) {
    case "pdf":
      return renderPdf(f.markdown);
    case "pdf-scan":
      return renderScannedPdf();
    case "pdf-long":
      return renderLongPdf(f.markdown);
    case "docx":
      return renderDocx(f.markdown);
    case "txt":
      return new TextEncoder().encode(toPlainText(f.markdown));
    case "md":
      return new TextEncoder().encode(f.markdown);
  }
}

/** Writes every fixture file plus its markdown source and expected result. */
export async function buildFixtures(): Promise<string[]> {
  mkdirSync(join(agreementsDir, "files"), { recursive: true });
  mkdirSync(join(agreementsDir, "sources"), { recursive: true });
  mkdirSync(join(agreementsDir, "expected"), { recursive: true });
  const written: string[] = [];
  for (const f of fixtures) {
    const file = join(agreementsDir, "files", fileNameFor(f));
    writeFileSync(file, await renderFixture(f));
    writeFileSync(join(agreementsDir, "sources", `${f.slug}.md`), f.markdown);
    writeFileSync(
      join(agreementsDir, "expected", `${f.slug}.json`),
      `${JSON.stringify({ slug: f.slug, title: f.title, type: f.type, file: fileNameFor(f), description: f.description, expected: f.expected }, null, 2)}\n`,
    );
    written.push(file);
  }
  return written;
}

if (import.meta.main) {
  const files = await buildFixtures();
  console.log(`wrote ${files.length} fixture agreements to ${join(agreementsDir, "files")}`);
}
