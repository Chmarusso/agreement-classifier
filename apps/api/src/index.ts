import { anonymizerFromEnv } from "@app/anonymization";
import { createDatabase, FileStorage, runMigrations } from "@app/db";
import { createApp } from "./app.ts";
import { bootstrapAdmin } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { AuditBroadcaster } from "./lib/broadcaster.ts";
import { ConsoleOtpDelivery } from "./lib/otp-delivery.ts";

const config = loadConfig(process.env);
const database = createDatabase(config.databaseUrl);
await runMigrations(database.db);
if (await bootstrapAdmin(database, config.bootstrapAdminEmail)) {
  console.info(`[api] bootstrapped admin ${config.bootstrapAdminEmail}`);
}

const broadcaster = new AuditBroadcaster(database);
await broadcaster.start();

const app = createApp({
  database,
  config,
  anonymizer: anonymizerFromEnv(process.env),
  otpDelivery: new ConsoleOtpDelivery(),
  broadcaster,
  storage: new FileStorage(config.storageDir),
});

const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 60, maxRequestBodySize: 25 * 1024 * 1024 });
console.info(`[api] listening on http://localhost:${server.port} (${config.appEnv})`);
if (config.devOtpCode) console.warn(`[api] development OTP code ${config.devOtpCode} is accepted for every user`);

const shutdown = async () => {
  server.stop();
  await broadcaster.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
