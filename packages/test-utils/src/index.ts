import { createDatabase, type Database, runMigrations } from "@app/db";
import type { EventMetadata } from "@app/domain";
import postgres from "postgres";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://audit:audit@localhost:5544/postgres";
const TEMPLATE = "audit_test_template";

function urlFor(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let templateReady: Promise<void> | null = null;

/** Creates (once per process) a migrated template database, recreated every run. */
async function ensureTemplate(): Promise<void> {
  templateReady ??= (async () => {
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`drop database if exists ${TEMPLATE} with (force)`);
      await admin.unsafe(`create database ${TEMPLATE}`);
    } finally {
      await admin.end();
    }
    const t = createDatabase(urlFor(TEMPLATE), { max: 1 });
    await runMigrations(t.db);
    await t.close();
  })();
  return templateReady;
}

export interface TestDatabase extends Database {
  url: string;
  drop(): Promise<void>;
}

/** A fresh, migrated, isolated database cloned from the template. */
export async function createTestDatabase(): Promise<TestDatabase> {
  await ensureTemplate();
  const name = `audit_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name} template ${TEMPLATE}`);
  await admin.end();
  const url = urlFor(name);
  const database = createDatabase(url, { max: 5 });
  return {
    ...database,
    url,
    async drop() {
      await database.close();
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export const systemMeta = (overrides: Partial<EventMetadata> = {}): EventMetadata => ({
  actorUserId: null,
  actorType: "system",
  correlationId: crypto.randomUUID(),
  causationId: null,
  requestId: null,
  ip: null,
  userAgent: null,
  ...overrides,
});

/**
 * Starts the Python anonymizer (apps/anonymizer) on a free port. It needs only python3,
 * so the tests run against the real service rather than a mock.
 */
export async function startAnonymizerService(): Promise<{ url: string; stop(): Promise<void> }> {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  const proc = Bun.spawn([process.env.PYTHON ?? "python3", "-m", "anonymizer.server"], {
    cwd: new URL("../../../apps/anonymizer", import.meta.url).pathname,
    env: { ...process.env, ANONYMIZER_HOST: "127.0.0.1", ANONYMIZER_PORT: String(port) },
    stdout: "ignore",
    stderr: "pipe",
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`The anonymizer exited: ${await new Response(proc.stderr).text()}`);
    const ok = await fetch(`${url}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error("The anonymizer did not start within 15 s");
    }
    await Bun.sleep(100);
  }
  return {
    url,
    async stop() {
      proc.kill();
      await proc.exited;
    },
  };
}
