/**
 * Previews anonymization of any agreement file, including PDF and DOCX:
 *   bun run anonymize seeds/agreements/files/nda-pl-compliant.md [--format diff|side|json|anonymized] [--lang pl|en] [--keep "Northwind Analytics"]
 * Text is extracted exactly as the worker does it, then handed to the Python anonymizer CLI. Nothing leaves the machine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat, extractText } from "@app/extraction";

const [file, ...rest] = process.argv.slice(2);
if (!file || file === "--help" || file === "-h") {
  console.error("Usage: bun run anonymize <file.pdf|.docx|.txt|.md> [--format diff|side|json|anonymized] [--lang pl|en] [--keep TERM]");
  process.exit(file ? 0 : 1);
}
const bytes = new Uint8Array(readFileSync(file));
const { text } = await extractText(bytes, detectFormat(bytes, file).format);
const keep = (process.env.ANONYMIZER_KEEP ?? "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .flatMap((k) => ["--keep", k]);

const python = process.env.PYTHON ?? "python3";
const proc = Bun.spawn([python, "-m", "anonymizer", "-", ...keep, ...rest], {
  cwd: join(import.meta.dir, "../../../apps/anonymizer"),
  stdin: new TextEncoder().encode(text),
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "" },
});
process.exit(await proc.exited);
