import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpAnonymizer } from "@app/anonymization";
import type { ErrorEnvelope } from "@app/contracts";
import { FileStorage } from "@app/db";
import { seedAllUsers } from "@app/seeds/users";
import { createTestDatabase, type TestDatabase } from "@app/test-utils";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { AuditBroadcaster } from "../src/lib/broadcaster.ts";
import { MemoryOtpDelivery } from "../src/lib/otp-delivery.ts";

export const DEV_CODE = "000000";
export const FIXTURE_FILES = join(import.meta.dir, "../../../seeds/agreements/files");

export async function createHarness(opts: { anonymizer?: HttpAnonymizer | null } = {}) {
  const t: TestDatabase = await createTestDatabase();
  await seedAllUsers(t);
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: t.url,
    AUTH_SECRET: "test-secret-test-secret",
    DEV_OTP_CODE: DEV_CODE,
  });
  const otp = new MemoryOtpDelivery();
  const broadcaster = new AuditBroadcaster(t);
  await broadcaster.start();
  const storage = new FileStorage(mkdtempSync(join(tmpdir(), "audit-uploads-")));
  const app = createApp({ database: t, config, otpDelivery: otp, broadcaster, storage, anonymizer: opts.anonymizer ?? null });

  async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.cookie) headers.cookie = opts.cookie;
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
    });
    return res;
  }

  /** Multipart upload of a fixture file (or given bytes) as the given user. */
  async function upload(fileName: string, agreementType: string, cookie: string, bytes?: Uint8Array) {
    const form = new FormData();
    form.set("file", new File([(bytes ?? readFileSync(join(FIXTURE_FILES, fileName))) as Uint8Array<ArrayBuffer>], fileName));
    form.set("agreementType", agreementType);
    return app.request("/api/v1/agreements", { method: "POST", body: form, headers: { cookie } });
  }

  async function login(email: string, code = DEV_CODE): Promise<string> {
    const res = await call("POST", "/auth/otp/verify", { body: { email, code } });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${await res.text()}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    return setCookie.split(";")[0]!;
  }

  return {
    t,
    app,
    otp,
    broadcaster,
    storage,
    call,
    login,
    upload,
    async close() {
      await broadcaster.stop();
      await t.drop();
    },
  };
}

export async function errorOf(res: Response): Promise<ErrorEnvelope["error"]> {
  return ((await res.json()) as ErrorEnvelope).error;
}
