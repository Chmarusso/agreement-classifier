import { OtpRequestBody, type OtpRequestResponse, OtpVerifyBody } from "@app/contracts";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { logout, requestOtp, requireUser, SESSION_COOKIE, verifyOtp } from "../lib/auth.ts";
import type { Deps, Env } from "../lib/context.ts";
import { parseJson } from "../lib/validate.ts";

export function authRoutes(deps: Deps) {
  return new Hono<Env>()
    .post("/otp/request", async (c) => {
      const body = await parseJson(c, OtpRequestBody);
      await requestOtp(deps, c, body.email);
      const res: OtpRequestResponse = { status: "sent", devCodeHint: deps.config.devOtpCode };
      return c.json(res, 202);
    })
    .post("/otp/verify", async (c) => {
      const body = await parseJson(c, OtpVerifyBody);
      const { token, me, expiresAt } = await verifyOtp(deps, c, body.email, body.code);
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: deps.config.secureCookies,
        path: "/",
        expires: expiresAt,
      });
      return c.json(me);
    })
    .post("/logout", requireUser, async (c) => {
      await logout(deps, c, c.get("user")!);
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.body(null, 204);
    })
    .get("/me", requireUser, (c) => {
      const { sessionId: _s, ...me } = c.get("user")!;
      return c.json(me);
    });
}
