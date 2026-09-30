import type { StoredEvent } from "@app/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../client.ts";
import { sessions, users } from "../schema.ts";

/** users.version tracks the User stream only, so it is safe for optimistic concurrency on edits. */
export async function projectUsers(tx: Tx, e: StoredEvent): Promise<void> {
  const at = e.occurredAt;
  if (e.streamType === "User") {
    const bump = { version: e.streamVersion, updatedAt: at };
    switch (e.type) {
      case "UserRegistered":
        await tx.insert(users).values({
          id: e.streamId,
          email: e.payload.email,
          displayName: e.payload.displayName,
          role: e.payload.role,
          status: "active",
          version: e.streamVersion,
          createdAt: at,
          updatedAt: at,
        });
        return;
      case "UserRoleChanged":
        await tx
          .update(users)
          .set({ role: e.payload.newRole, ...bump })
          .where(eq(users.id, e.streamId));
        return;
      case "UserDeactivated":
        await tx
          .update(users)
          .set({ status: "deactivated", ...bump })
          .where(eq(users.id, e.streamId));
        await tx
          .update(sessions)
          .set({ revokedAt: at })
          .where(and(eq(sessions.userId, e.streamId), isNull(sessions.revokedAt)));
        return;
      case "UserReactivated":
        await tx
          .update(users)
          .set({ status: "active", ...bump })
          .where(eq(users.id, e.streamId));
        return;
      default:
        await tx.update(users).set(bump).where(eq(users.id, e.streamId));
        return;
    }
  }
  if (e.streamType === "UserAuth") {
    switch (e.type) {
      case "OtpVerified": {
        await tx.update(users).set({ lastLoginAt: at }).where(eq(users.id, e.streamId));
        // A login racing a deactivation must not leave a usable session behind.
        const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, e.streamId));
        await tx.insert(sessions).values({
          id: e.payload.sessionId,
          userId: e.streamId,
          tokenHash: e.payload.tokenHash,
          createdAt: at,
          expiresAt: new Date(e.payload.sessionExpiresAt),
          revokedAt: u?.status === "active" ? null : at,
        });
        return;
      }
      case "UserLoggedOut":
        await tx.update(sessions).set({ revokedAt: at }).where(eq(sessions.id, e.payload.sessionId));
        return;
      default:
        return;
    }
  }
}
