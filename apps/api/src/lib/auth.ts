import type { MeDto } from "@app/contracts";
import { AuthAggregate, executeCommand, sessions, users } from "@app/db";
import {
  AppError,
  generateOtpCode,
  generateSessionToken,
  hashOtpCode,
  hashSessionToken,
  OTP_TTL_MS,
  type Role,
  SESSION_TTL_MS,
} from "@app/domain";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { type Ctx, type CurrentUser, type Deps, type Env, metaFrom } from "./context.ts";

export const SESSION_COOKIE = "sid";
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

async function findUserByEmail(deps: Deps, email: string) {
  const [u] = await deps.database.db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return u ?? null;
}

/** Issues a code. Unknown or inactive emails get the same response and no event, to avoid enumeration. */
export async function requestOtp(deps: Deps, c: Ctx, email: string): Promise<void> {
  const user = await findUserByEmail(deps, email);
  if (user?.status !== "active") return;
  const code = generateOtpCode();
  const { events } = await executeCommand(
    deps.database.db,
    AuthAggregate,
    user.id,
    {
      type: "RequestOtp",
      userActive: true,
      codeHash: hashOtpCode(deps.config.authSecret, user.id, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      deliveryChannel: deps.otpDelivery.channel,
    },
    metaFrom(c),
  );
  if (events.length > 0) await deps.otpDelivery.send(user.email, code);
}

export async function verifyOtp(deps: Deps, c: Ctx, email: string, code: string): Promise<{ token: string; me: MeDto; expiresAt: Date }> {
  const user = await findUserByEmail(deps, email);
  if (!user) throw new AppError("UNAUTHORIZED", "The email or code is not valid.");

  const now = new Date();
  const token = generateSessionToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const isDevCode = deps.config.devOtpCode !== null && code === deps.config.devOtpCode;

  const { events } = await executeCommand(
    deps.database.db,
    AuthAggregate,
    user.id,
    {
      type: "VerifyOtp",
      userActive: user.status === "active",
      now,
      submittedHash: hashOtpCode(deps.config.authSecret, user.id, code),
      isDevCode,
      sessionId,
      tokenHash: hashSessionToken(token),
      sessionExpiresAt: expiresAt,
    },
    // The login attempt is attributed to the user it targets.
    { ...metaFrom(c), actorUserId: user.id, actorType: "user" },
  );

  const outcome = events[0];
  if (outcome?.type === "OtpVerified") {
    return {
      token,
      expiresAt,
      me: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    };
  }
  if (outcome?.type === "OtpVerificationFailed") {
    switch (outcome.payload.reason) {
      case "locked":
        throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again in 15 minutes.");
      case "expired":
        throw new AppError("UNAUTHORIZED", "The code has expired. Request a new one.");
      case "mismatch":
        if (outcome.payload.lockedUntil) {
          throw new AppError("RATE_LIMITED", "Too many failed attempts. Try again in 15 minutes.");
        }
        throw new AppError("UNAUTHORIZED", "The email or code is not valid.");
      default:
        throw new AppError("UNAUTHORIZED", "The email or code is not valid.");
    }
  }
  throw new AppError("INTERNAL", "Login did not produce an outcome.");
}

export async function logout(deps: Deps, c: Ctx, user: CurrentUser): Promise<void> {
  await executeCommand(deps.database.db, AuthAggregate, user.id, { type: "Logout", sessionId: user.sessionId }, metaFrom(c));
}

/** Resolves the session cookie to a user, sliding the expiry forward once a day. */
export const sessionMiddleware = (deps: Deps) =>
  createMiddleware<Env>(async (c, next) => {
    c.set("user", null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const now = new Date();
      const [row] = await deps.database.db
        .select({ s: sessions, u: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hashSessionToken(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            eq(users.status, "active"),
          ),
        );
      if (row) {
        c.set("user", {
          id: row.u.id,
          email: row.u.email,
          displayName: row.u.displayName,
          role: row.u.role,
          sessionId: row.s.id,
        });
        const fresh = new Date(now.getTime() + SESSION_TTL_MS);
        if (fresh.getTime() - row.s.expiresAt.getTime() > SLIDE_AFTER_MS) {
          await deps.database.db.update(sessions).set({ expiresAt: fresh }).where(eq(sessions.id, row.s.id));
        }
      }
    }
    await next();
  });

export const requireUser = createMiddleware<Env>(async (c, next) => {
  if (!c.get("user")) throw new AppError("UNAUTHORIZED", "Log in to continue.");
  await next();
});

const rank: Record<Role, number> = { viewer: 0, auditor: 1, admin: 2 };

export const requireRole = (min: Role) =>
  createMiddleware<Env>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new AppError("UNAUTHORIZED", "Log in to continue.");
    if (rank[user.role] < rank[min]) throw new AppError("FORBIDDEN", "You do not have permission for this action.");
    await next();
  });
