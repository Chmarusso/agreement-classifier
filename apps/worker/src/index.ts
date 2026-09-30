import { anonymizerFromEnv } from "@app/anonymization";
import { createDatabase, FileStorage, loadAuditModelSetting } from "@app/db";
import type { AuditModelConfig } from "@app/domain";
import { type AuditModelClient, createAuditClient, environmentAuditModel, resolveAuditModel, votingFromEnv } from "@app/llm";
import { fixtureResponder } from "@app/seeds/stub";
import { extractTextHandler, runAuditHandler } from "./handlers.ts";
import { Worker } from "./worker.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const database = createDatabase(url, { max: 5 });
const storage = new FileStorage(process.env.STORAGE_DIR ?? "./data/uploads");
const voting = votingFromEnv(process.env);
const anonymizer = anonymizerFromEnv(process.env);
if (anonymizer) {
  const health = await anonymizer.health().catch((err: Error) => ({ ok: false, engine: err.message, ner: false }));
  console.info(`[worker] anonymization on via ${anonymizer.label}: ${health.ok ? health.engine : `not reachable yet (${health.engine})`}`);
} else {
  console.warn("[worker] anonymization off: ANONYMIZER_URL is not set, agreement text goes to the model as extracted");
}

// Each run carries the model decided when it was requested; older runs fall back to the current admin setting.
const currentModel = async () => resolveAuditModel(process.env, (await loadAuditModelSetting(database.db)).config);
const clients = new Map<string, AuditModelClient>();
const clientFor = async (recorded: AuditModelConfig | null): Promise<AuditModelClient> => {
  const resolved = recorded ? resolveAuditModel(process.env, recorded) : await currentModel();
  // The label omits the reasoning mode, so it is part of the cache key.
  const key = `${resolved.label}#${resolved.reasoning}`;
  let client = clients.get(key);
  if (!client) {
    client = createAuditClient(resolved, process.env, fixtureResponder);
    clients.set(key, client);
    console.info(`[worker] audit model ${client.label} (${resolved.source})`);
  }
  return client;
};

const worker = new Worker({
  database,
  version: process.env.APP_VERSION ?? "dev",
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
  handlers: {
    extract_text: extractTextHandler(storage, currentModel, anonymizer),
    run_audit: runAuditHandler(clientFor, { timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180_000), voting, anonymizer }),
  },
});
await worker.start();
console.info(
  `[worker] ${worker.workerId} started; default audit model ${environmentAuditModel(process.env).label}; voting ${voting.mode} x${voting.samples}; storage ${storage.root}`,
);

const shutdown = async (signal: string) => {
  await worker.stop(signal);
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
