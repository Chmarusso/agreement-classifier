import { createDatabase } from "../client.ts";
import { runMigrations } from "../migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = createDatabase(url, { max: 1 });
await runMigrations(database.db);
console.log("migrations applied");
await database.close();
