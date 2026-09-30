import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Renders the demo agreement to PDF with headless Chrome, which keeps Polish characters
// (the pdf-lib fixture renderer only has WinAnsi fonts): bun run seeds/demo/build.ts
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = import.meta.dir;
const markdown = readFileSync(join(dir, "saas-pl-ai-training.md"), "utf8");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function table(lines: string[]): string {
  const rows = lines
    .filter((l) => !/^\|\s*-{3}/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split("|")
        .map((c) => esc(c.trim())),
    );
  const [head, ...body] = rows;
  return `<table><thead><tr>${head!.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const html = markdown
  .trim()
  .split(/\n{2,}/)
  .map((chunk) => {
    if (chunk.startsWith("# ")) return `<h1>${esc(chunk.slice(2))}</h1>`;
    if (chunk.startsWith("## Załącznik")) return `<h2 class="annex">${esc(chunk.slice(3))}</h2>`;
    if (chunk.startsWith("## ")) return `<h2>${esc(chunk.slice(3))}</h2>`;
    if (chunk.startsWith("|")) return table(chunk.split("\n"));
    if (/^\d+\. /.test(chunk))
      return chunk
        .split("\n")
        .map((l) => `<p class="num">${esc(l)}</p>`)
        .join("\n");
    return `<p${chunk === "a" ? ' class="center"' : ""}>${esc(chunk)}</p>`;
  })
  .join("\n");

const page = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 25mm 22mm 25mm 22mm; }
body { font-family: "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 15pt; text-align: center; margin: 0 0 18pt; }
h2 { font-size: 11.5pt; text-align: center; margin: 16pt 0 6pt; break-after: avoid; }
h2.annex { break-before: page; font-size: 12.5pt; }
p { text-align: justify; margin: 0 0 6pt; }
p.num { padding-left: 1.4em; text-indent: -1.4em; }
p.center { text-align: center; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 10pt; break-inside: avoid; }
th, td { border: 0.6pt solid #444; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #eee; }
</style></head><body>${html}</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "demo-pdf-"));
const htmlPath = join(tmp, "agreement.html");
const out = join(dir, "saas-pl-ai-training.pdf");
writeFileSync(htmlPath, page);
const proc = Bun.spawnSync(
  [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${out}`, `file://${htmlPath}`],
  {
    stderr: "pipe",
  },
);
rmSync(tmp, { recursive: true });
if (proc.exitCode !== 0) throw new Error(`Chrome failed: ${proc.stderr.toString()}`);
console.info("wrote seeds/demo/saas-pl-ai-training.pdf");
