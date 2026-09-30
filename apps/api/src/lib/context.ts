import type { HttpAnonymizer } from "@app/anonymization";
import type { Database, FileStorage } from "@app/db";
import type { EventMetadata, Role } from "@app/domain";
import type { Context } from "hono";
import type { Config } from "../config.ts";
import type { AuditBroadcaster } from "./broadcaster.ts";
import type { OtpDelivery } from "./otp-delivery.ts";

export interface Deps {
  database: Database;
  config: Config;
  otpDelivery: OtpDelivery;
  broadcaster: AuditBroadcaster;
  storage: FileStorage;
  /** The local anonymizer, for the admin settings page; null when ANONYMIZER_URL is not set. */
  anonymizer?: HttpAnonymizer | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  sessionId: string;
}

export type Env = {
  Variables: {
    requestId: string;
    user: CurrentUser | null;
  };
};

export type Ctx = Context<Env>;

export function metaFrom(c: Ctx): EventMetadata {
  const user = c.get("user");
  return {
    actorUserId: user?.id ?? null,
    actorType: user ? "user" : "anonymous",
    correlationId: c.get("requestId"),
    causationId: null,
    requestId: c.get("requestId"),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  };
}
