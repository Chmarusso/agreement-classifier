import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Local-disk file store shared by the API (writes uploads) and the worker (reads them). */
export class FileStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  keyFor(id: string, sha256: string, ext: string): string {
    return `${sha256.slice(0, 2)}/${id}.${ext}`;
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(`${this.root}/`)) throw new Error("Storage key escapes the storage root");
    return p;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }
}
