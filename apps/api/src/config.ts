import { environmentAuditModel, type ProviderAvailability, providerAvailability, type ResolvedAuditModel } from "@app/llm";
import { z } from "zod";

const Env = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  DEV_OTP_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  BOOTSTRAP_ADMIN_EMAIL: z
    .string()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  API_PORT: z.coerce.number().int().default(3000),
  STORAGE_DIR: z.string().default("./data/uploads"),
});

export interface Config {
  appEnv: "development" | "test" | "production";
  databaseUrl: string;
  authSecret: string;
  devOtpCode: string | null;
  bootstrapAdminEmail: string | null;
  port: number;
  secureCookies: boolean;
  storageDir: string;
  /** The process environment, so admin settings resolve against the same defaults the worker reads. */
  llmEnv: Record<string, string | undefined>;
  /** Model the worker uses when no admin setting is stored. */
  environmentAuditModel: ResolvedAuditModel;
  providers: ProviderAvailability[];
}

/** Parses the environment. Throws when a development-only setting reaches production. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const e = Env.parse(env);
  if (e.APP_ENV === "production" && e.DEV_OTP_CODE) {
    throw new Error("DEV_OTP_CODE must not be set when APP_ENV=production. Refusing to start.");
  }
  if (e.APP_ENV === "production" && e.AUTH_SECRET === "change-me-in-production") {
    throw new Error("AUTH_SECRET still has the example value. Refusing to start.");
  }
  return {
    appEnv: e.APP_ENV,
    databaseUrl: e.DATABASE_URL,
    authSecret: e.AUTH_SECRET,
    devOtpCode: e.DEV_OTP_CODE ?? null,
    bootstrapAdminEmail: e.BOOTSTRAP_ADMIN_EMAIL ?? null,
    port: e.API_PORT,
    secureCookies: e.APP_ENV === "production",
    storageDir: e.STORAGE_DIR,
    llmEnv: env,
    environmentAuditModel: environmentAuditModel(env),
    providers: providerAvailability(env),
  };
}
