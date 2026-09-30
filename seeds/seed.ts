import { createDatabase, runMigrations } from "@app/db";
import { seedAllRules } from "./catalog.ts";
import { seedAllUsers } from "./users.ts";

if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed: APP_ENV=production");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const database = createDatabase(url, { max: 2 });
await runMigrations(database.db);
const result = await seedAllUsers(database);
console.log(`users created: ${result.created.join(", ") || "none"}; skipped: ${result.skipped.join(", ") || "none"}`);
const ruleResult = await seedAllRules(database);
console.log(`rules created: ${ruleResult.created}; skipped: ${ruleResult.skipped}`);
console.log("Fixture agreements to upload are in seeds/agreements/files (expected results in seeds/agreements/expected).");
await database.close();
