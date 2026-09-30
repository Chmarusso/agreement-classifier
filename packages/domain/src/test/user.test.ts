import { describe, expect, test } from "bun:test";
import {
  AppError,
  type AuthCommand,
  type AuthState,
  decideAuth,
  decideUser,
  evolveAuth,
  evolveUser,
  hashOtpCode,
  initialAuthState,
  initialUserState,
  type NewEvent,
  OTP_MAX_ATTEMPTS,
  type UserState,
} from "../index.ts";

const SECRET = "test-secret-test-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-25T12:00:00Z");

function given(events: NewEvent[]): UserState {
  return events.reduce(evolveUser, initialUserState());
}
function givenAuth(events: NewEvent[]): AuthState {
  return events.reduce(evolveAuth, initialAuthState());
}
const registered: NewEvent = {
  type: "UserRegistered",
  payload: { email: "a@example.com", displayName: "A", role: "auditor", invitedBy: null },
};
const otpFor = (code: string, expiresAt = new Date(now.getTime() + 60_000)): NewEvent => ({
  type: "OtpRequested",
  payload: { codeHash: hashOtpCode(SECRET, USER, code), expiresAt: expiresAt.toISOString(), deliveryChannel: "console" },
});
const verify = (code: string, over: Partial<Extract<AuthCommand, { type: "VerifyOtp" }>> = {}): AuthCommand => ({
  type: "VerifyOtp",
  userActive: true,
  now,
  submittedHash: hashOtpCode(SECRET, USER, code),
  isDevCode: false,
  sessionId: crypto.randomUUID(),
  tokenHash: "a".repeat(64),
  sessionExpiresAt: new Date(now.getTime() + 1000),
  ...over,
});

describe("User registration", () => {
  test("registers a new user with lower-cased email", () => {
    const [e] = decideUser(initialUserState(), {
      type: "RegisterUser",
      email: "Mixed@Example.com",
      displayName: "M",
      role: "viewer",
      invitedBy: null,
    });
    expect(e).toMatchObject({ type: "UserRegistered", payload: { email: "mixed@example.com", role: "viewer" } });
  });

  test("rejects registering the same stream twice", () => {
    expect(() =>
      decideUser(given([registered]), { type: "RegisterUser", email: "x@example.com", displayName: "X", role: "viewer", invitedBy: null }),
    ).toThrow(AppError);
  });

  test("commands on a missing user fail with NOT_FOUND", () => {
    try {
      decideUser(initialUserState(), { type: "ChangeUserRole", role: "admin" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AppError).code).toBe("NOT_FOUND");
    }
  });
});

describe("User lifecycle", () => {
  test("role change emits old and new role", () => {
    expect(decideUser(given([registered]), { type: "ChangeUserRole", role: "admin" })).toEqual([
      { type: "UserRoleChanged", payload: { oldRole: "auditor", newRole: "admin" } },
    ]);
  });

  test("changing to the same role emits nothing", () => {
    expect(decideUser(given([registered]), { type: "ChangeUserRole", role: "auditor" })).toEqual([]);
  });

  test("deactivate is idempotent", () => {
    const state = given([registered, { type: "UserDeactivated", payload: { reason: null } }]);
    expect(decideUser(state, { type: "DeactivateUser", reason: "again" })).toEqual([]);
  });

  test("deactivated user gets no OTP", () => {
    expect(
      decideAuth(initialAuthState(), {
        type: "RequestOtp",
        userActive: false,
        codeHash: "b".repeat(64),
        expiresAt: now,
        deliveryChannel: "console",
      }),
    ).toEqual([]);
  });
});

describe("OTP verification", () => {
  test("correct code verifies and consumes the code", () => {
    const state = givenAuth([otpFor("123456")]);
    const [e] = decideAuth(state, verify("123456"));
    expect(e?.type).toBe("OtpVerified");
    const after = evolveAuth(state, e!);
    expect(after.otp).toBeNull();
    const [again] = decideAuth(after, verify("123456"));
    expect(again).toMatchObject({ type: "OtpVerificationFailed", payload: { reason: "no_code" } });
  });

  test("dev code verifies without a requested OTP", () => {
    const [e] = decideAuth(givenAuth([]), verify("000000", { isDevCode: true }));
    expect(e).toMatchObject({ type: "OtpVerified", payload: { usedDevCode: true } });
  });

  test("wrong code fails with mismatch and counts attempts", () => {
    const [e] = decideAuth(givenAuth([otpFor("123456")]), verify("999999"));
    expect(e).toEqual({ type: "OtpVerificationFailed", payload: { reason: "mismatch", attemptNo: 1, lockedUntil: null } });
  });

  test("expired code fails with expired", () => {
    const [e] = decideAuth(givenAuth([otpFor("123456", new Date(now.getTime() - 1))]), verify("123456"));
    expect(e).toMatchObject({ payload: { reason: "expired" } });
  });

  test(`${OTP_MAX_ATTEMPTS} mismatches lock the user for 15 minutes`, () => {
    let state = givenAuth([otpFor("123456")]);
    let last: NewEvent | undefined;
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      [last] = decideAuth(state, verify("999999"));
      state = evolveAuth(state, last!);
    }
    expect(last).toMatchObject({ payload: { reason: "mismatch", attemptNo: OTP_MAX_ATTEMPTS } });
    expect((last as Extract<NewEvent, { type: "OtpVerificationFailed" }>).payload.lockedUntil).toBe(
      new Date(now.getTime() + 15 * 60_000).toISOString(),
    );
    const [locked] = decideAuth(state, verify("123456"));
    expect(locked).toMatchObject({ payload: { reason: "locked" } });
    const [devWhileLocked] = decideAuth(state, verify("000000", { isDevCode: true }));
    expect(devWhileLocked).toMatchObject({ payload: { reason: "locked" } });
  });

  test("lock expires after 15 minutes", () => {
    let state = givenAuth([otpFor("123456")]);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) state = evolveAuth(state, decideAuth(state, verify("999999"))[0]!);
    state = evolveAuth(state, otpFor("222222", new Date(now.getTime() + 60 * 60_000)));
    const [e] = decideAuth(state, verify("222222", { now: new Date(now.getTime() + 16 * 60_000) }));
    expect(e?.type).toBe("OtpVerified");
  });

  test("deactivated user cannot verify, even with the dev code", () => {
    expect(decideAuth(initialAuthState(), verify("000000", { isDevCode: true, userActive: false }))[0]).toMatchObject({
      payload: { reason: "inactive" },
    });
  });

  test("logout emits only for a known session", () => {
    const sessionId = crypto.randomUUID();
    const state = givenAuth([
      { type: "OtpVerified", payload: { sessionId, tokenHash: "c".repeat(64), sessionExpiresAt: now.toISOString(), usedDevCode: true } },
    ]);
    expect(decideAuth(state, { type: "Logout", sessionId })).toEqual([{ type: "UserLoggedOut", payload: { sessionId } }]);
    expect(decideAuth(state, { type: "Logout", sessionId: crypto.randomUUID() })).toEqual([]);
  });
});
