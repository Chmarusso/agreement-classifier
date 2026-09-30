import type { EventPayload, NewEvent, StoredEvent } from "./events.ts";
import { hashesEqual, OTP_LOCK_MS, OTP_MAX_ATTEMPTS } from "./otp.ts";
import { ev } from "./user.ts";

/** Login state of one user, kept on the UserAuth stream (stream id = user id). */
export interface AuthState {
  otp: { codeHash: string; expiresAt: Date } | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  sessions: Set<string>;
}

export const initialAuthState = (): AuthState => ({ otp: null, failedAttempts: 0, lockedUntil: null, sessions: new Set() });

export function evolveAuth(state: AuthState, event: StoredEvent | NewEvent): AuthState {
  switch (event.type) {
    case "OtpRequested":
      return { ...state, otp: { codeHash: event.payload.codeHash, expiresAt: new Date(event.payload.expiresAt) } };
    case "OtpVerified":
      return {
        ...state,
        otp: null,
        failedAttempts: 0,
        lockedUntil: null,
        sessions: new Set([...state.sessions, event.payload.sessionId]),
      };
    case "OtpVerificationFailed": {
      const lockedUntil = event.payload.lockedUntil ? new Date(event.payload.lockedUntil) : null;
      return {
        ...state,
        failedAttempts: lockedUntil ? 0 : event.payload.attemptNo,
        lockedUntil: lockedUntil ?? state.lockedUntil,
        otp: lockedUntil ? null : state.otp,
      };
    }
    case "UserLoggedOut": {
      const sessions = new Set(state.sessions);
      sessions.delete(event.payload.sessionId);
      return { ...state, sessions };
    }
    default:
      return state;
  }
}

export type AuthCommand =
  | { type: "RequestOtp"; userActive: boolean; codeHash: string; expiresAt: Date; deliveryChannel: "console" | "email" }
  | {
      type: "VerifyOtp";
      userActive: boolean;
      now: Date;
      /** HMAC of the submitted code, computed by the caller with the user's id. */
      submittedHash: string;
      /** True when the submitted code equals the configured development code. */
      isDevCode: boolean;
      sessionId: string;
      tokenHash: string;
      sessionExpiresAt: Date;
    }
  | { type: "Logout"; sessionId: string };

export function decideAuth(state: AuthState, cmd: AuthCommand): NewEvent[] {
  switch (cmd.type) {
    case "RequestOtp":
      if (!cmd.userActive) return [];
      return [
        ev("OtpRequested", {
          codeHash: cmd.codeHash,
          expiresAt: cmd.expiresAt.toISOString(),
          deliveryChannel: cmd.deliveryChannel,
        }),
      ];
    case "VerifyOtp":
      return [decideVerify(state, cmd)];
    case "Logout":
      if (!state.sessions.has(cmd.sessionId)) return [];
      return [ev("UserLoggedOut", { sessionId: cmd.sessionId })];
  }
}

function decideVerify(state: AuthState, cmd: Extract<AuthCommand, { type: "VerifyOtp" }>): NewEvent {
  const fail = (reason: EventPayload<"OtpVerificationFailed">["reason"], attemptNo: number, lockedUntil: Date | null = null) =>
    ev("OtpVerificationFailed", { reason, attemptNo, lockedUntil: lockedUntil?.toISOString() ?? null });

  if (!cmd.userActive) return fail("inactive", state.failedAttempts);
  if (state.lockedUntil && state.lockedUntil > cmd.now) return fail("locked", state.failedAttempts);

  const success = () =>
    ev("OtpVerified", {
      sessionId: cmd.sessionId,
      tokenHash: cmd.tokenHash,
      sessionExpiresAt: cmd.sessionExpiresAt.toISOString(),
      usedDevCode: cmd.isDevCode,
    });

  if (cmd.isDevCode) return success();
  if (!state.otp) return fail("no_code", state.failedAttempts);
  if (state.otp.expiresAt <= cmd.now) return fail("expired", state.failedAttempts);
  if (hashesEqual(state.otp.codeHash, cmd.submittedHash)) return success();

  const attemptNo = state.failedAttempts + 1;
  const lockedUntil = attemptNo >= OTP_MAX_ATTEMPTS ? new Date(cmd.now.getTime() + OTP_LOCK_MS) : null;
  return fail("mismatch", attemptNo, lockedUntil);
}
