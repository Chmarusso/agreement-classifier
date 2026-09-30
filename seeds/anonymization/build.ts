/** Writes the anonymization samples to seeds/anonymization/files plus what each must replace and keep. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Fixture } from "../fixtures/agreements.ts";
import { renderFixture } from "../fixtures/build.ts";
import { anonymizationSamples, sampleFileName } from "./samples.ts";

const dir = import.meta.dir;
mkdirSync(join(dir, "files"), { recursive: true });
mkdirSync(join(dir, "expected"), { recursive: true });
mkdirSync(join(dir, "sources"), { recursive: true });
for (const s of anonymizationSamples) {
  writeFileSync(join(dir, "files", sampleFileName(s)), await renderFixture({ format: s.format, markdown: s.markdown } as Fixture));
  writeFileSync(join(dir, "sources", `${s.slug}.md`), s.markdown);
  const { markdown: _m, ...expected } = s;
  writeFileSync(join(dir, "expected", `${s.slug}.json`), `${JSON.stringify({ file: sampleFileName(s), ...expected }, null, 2)}\n`);
}
console.log(`wrote ${anonymizationSamples.length} anonymization samples to ${join(dir, "files")}`);
