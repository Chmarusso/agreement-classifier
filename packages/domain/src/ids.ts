import { createHash } from "node:crypto";

const NAMESPACE = "6f1c1e8a-3b2d-4f5e-9a7b-0c4d2e1f3a5b";

/** RFC 4122 version 5 UUID. Gives seeds, fixtures, and evals the same rule ids. */
export function uuidV5(name: string, namespace = NAMESPACE): string {
  const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const ruleIdForSlug = (slug: string) => uuidV5(`rule:${slug}`);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
