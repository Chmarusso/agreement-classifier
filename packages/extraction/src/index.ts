import { type AgreementFormat, MAX_AGREEMENT_CHARS } from "@app/domain";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Fewer meaningful characters than this means there is no usable text layer. */
export const MIN_TEXT_CHARS = 200;

export type ExtractionFailureReason = "no_text_layer" | "corrupt" | "unsupported" | "too_large";

export class ExtractionError extends Error {
  constructor(
    readonly reason: ExtractionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

const MIME: Record<AgreementFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/**
 * Detects the format from the file's bytes. The extension only chooses between
 * TXT and MD once the bytes are known to be text. A renamed binary is rejected.
 */
export function detectFormat(bytes: Uint8Array, fileName: string): { format: AgreementFormat; mimeType: string } {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { format: "pdf", mimeType: MIME.pdf };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
    if (head.includes("word/")) return { format: "docx", mimeType: MIME.docx };
    throw new ExtractionError("unsupported", "ZIP archives other than Word .docx files are not supported.");
  }
  if (bytes.length > 0 && isUtf8Text(bytes) && (ext === "md" || ext === "markdown" || ext === "txt")) {
    const format = ext === "txt" ? "txt" : "md";
    return { format, mimeType: MIME[format] };
  }
  throw new ExtractionError("unsupported", "Only PDF, DOCX, TXT and MD files are supported.");
}

function isUtf8Text(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

export interface ExtractedText {
  text: string;
  pageCount: number | null;
  extractor: string;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–]\s*\d{1,4}\s*[-–]$/i;

/**
 * Removes running headers, footers and page numbers from per-page PDF text.
 * A line counts as page furniture when it looks like a page number, or when the
 * same line (digits ignored) appears on at least half of the pages (minimum 3).
 * Without this, a header lands in the middle of any clause that crosses a page.
 */
export function stripPageFurniture(pages: string[]): string {
  const key = (l: string) => l.trim().replace(/\d+/g, "#");
  const perPage = pages.map((p) => p.split("\n"));
  const counts = new Map<string, number>();
  for (const lines of perPage) for (const k of new Set(lines.map(key).filter(Boolean))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const threshold = Math.max(3, Math.ceil(pages.length / 2));
  const repeated = new Set([...counts].filter(([, n]) => pages.length >= 3 && n >= threshold).map(([k]) => k));
  return perPage.map((lines) => lines.filter((l) => !PAGE_NUMBER.test(l.trim()) && !repeated.has(key(l))).join("\n")).join("\n");
}

export async function extractText(bytes: Uint8Array, format: AgreementFormat): Promise<ExtractedText> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ExtractionError("too_large", "The file is larger than 20 MB.");
  let result: ExtractedText;
  try {
    switch (format) {
      case "pdf": {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { totalPages, text } = await extractPdfText(pdf, { mergePages: false });
        result = { text: normalizeText(stripPageFurniture(text)), pageCount: totalPages, extractor: "unpdf" };
        break;
      }
      case "docx": {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        result = { text: normalizeText(value), pageCount: null, extractor: "mammoth" };
        break;
      }
      case "txt":
      case "md":
        result = { text: normalizeText(new TextDecoder("utf-8").decode(bytes)), pageCount: null, extractor: "utf8" };
        break;
    }
  } catch (err) {
    throw new ExtractionError(
      "corrupt",
      `The ${format.toUpperCase()} file could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const meaningful = result.text.replace(/\s/g, "").length;
  if (meaningful < MIN_TEXT_CHARS) {
    throw new ExtractionError(
      "no_text_layer",
      format === "pdf"
        ? "The PDF has no readable text layer. It is probably a scan; OCR is not supported."
        : `The document contains only ${meaningful} characters of text.`,
    );
  }
  if (result.text.length > MAX_AGREEMENT_CHARS) {
    throw new ExtractionError(
      "too_large",
      `The agreement has ${result.text.length.toLocaleString("en")} characters; the limit is ${MAX_AGREEMENT_CHARS.toLocaleString("en")}.`,
    );
  }
  return result;
}
export * from "./language.ts";
export * from "./sections.ts";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A readable HTML page of the original DOCX, for previewing in the browser.
 * mammoth emits only structural markup (headings, paragraphs, lists, tables); the
 * API serves it with a CSP that blocks scripts, so a crafted file cannot run code.
 */
export async function docxPreviewHtml(bytes: Uint8Array, title: string): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: ["p[style-name='Title'] => h1:fresh"] });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.6 Georgia,serif;color:#222;background:#f7f7f7;margin:0}main{max-width:780px;margin:24px auto;background:#fff;padding:48px 56px;border:1px solid #e4e4e4}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}@media(max-width:600px){main{margin:0;padding:24px 16px;border:0}}</style>
</head><body><main>${value}</main></body></html>`;
}
