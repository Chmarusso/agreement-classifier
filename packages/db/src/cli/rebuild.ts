import { createDatabase } from "../client.ts";
import { rebuildProjections } from "../rebuild.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = createDatabase(url, { max: 1 });
const count = await rebuildProjections(database.db);
console.log(`replayed ${count} events`);
await database.close();
