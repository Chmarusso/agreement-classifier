import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { readAll } from "./event-store.ts";
import { applyInlineProjections } from "./projections/index.ts";
import { projectionTables } from "./schema.ts";

/** Truncates every projection and replays the whole event store in one transaction. */
export async function rebuildProjections(db: Db, batchSize = 500): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate ${projectionTables.join(", ")}`));
    let position = 0;
    let count = 0;
    for (;;) {
      const batch = await readAll(tx, position, batchSize);
      if (batch.length === 0) break;
      for (const event of batch) await applyInlineProjections(tx, event);
      position = batch[batch.length - 1]!.globalPosition;
      count += batch.length;
    }
    return count;
  });
}
