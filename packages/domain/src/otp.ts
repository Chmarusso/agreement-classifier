import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** HMAC of the code bound to the user, so a leaked hash is useless for other users. */
export function hashOtpCode(secret: string, userId: string, code: string): string {
  return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");
}

export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
