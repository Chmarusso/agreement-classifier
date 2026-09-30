import { type Database, executeCommand, UserAggregate, users } from "@app/db";
import { count } from "drizzle-orm";

/** Registers the first admin when the users table is empty. */
export async function bootstrapAdmin(database: Database, email: string | null): Promise<boolean> {
  if (!email) return false;
  const [row] = await database.db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) > 0) return false;
  await executeCommand(
    database.db,
    UserAggregate,
    crypto.randomUUID(),
    { type: "RegisterUser", email, displayName: "Administrator", role: "admin", invitedBy: null },
    {
      actorUserId: null,
      actorType: "system",
      correlationId: crypto.randomUUID(),
      causationId: null,
      requestId: null,
      ip: null,
      userAgent: null,
    },
  );
  return true;
}
