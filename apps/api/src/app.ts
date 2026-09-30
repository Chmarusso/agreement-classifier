import type { ErrorEnvelope } from "@app/contracts";
import { AppError, statusForCode } from "@app/domain";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sessionMiddleware } from "./lib/auth.ts";
import type { Deps, Env } from "./lib/context.ts";
import { agreementRoutes } from "./routes/agreements.ts";
import { auditLogRoutes } from "./routes/audit-log.ts";
import { auditRoutes } from "./routes/audits.ts";
import { authRoutes } from "./routes/auth.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { systemRoutes } from "./routes/system.ts";
import { userRoutes } from "./routes/users.ts";

function uniqueViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; constraint_name?: string; cause?: unknown };
    if (x.code === "23505") return x.constraint_name ?? "unique";
    e = x.cause;
  }
  return null;
}

export function createApp(deps: Deps) {
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });
  app.use(sessionMiddleware(deps));

  const api = new Hono<Env>()
    .route("/", systemRoutes(deps))
    .route("/auth", authRoutes(deps))
    .route("/users", userRoutes(deps))
    .route("/audit-log", auditLogRoutes(deps))
    .route("/rules", ruleRoutes(deps))
    .route("/agreements", agreementRoutes(deps))
    .route("/audits", auditRoutes(deps))
    .route("/settings", settingsRoutes(deps));
  app.route("/api/v1", api);

  app.notFound((c) => {
    const body: ErrorEnvelope = {
      error: { code: "NOT_FOUND", message: "Not found.", details: [], requestId: c.get("requestId") },
    };
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? crypto.randomUUID();
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (uniqueViolation(err) === "users_email_uq") {
      appErr = new AppError("CONFLICT", "A user with this email already exists.", [{ path: "email", message: "Already registered" }]);
    } else if (err instanceof HTTPException && err.status === 413) {
      appErr = new AppError("PAYLOAD_TOO_LARGE", "The upload is too large.");
    } else {
      console.error(`[api] ${requestId} unhandled error`, err);
      appErr = new AppError("INTERNAL", "Something went wrong. Quote the request id when reporting it.");
    }
    const body: ErrorEnvelope = {
      error: { code: appErr.code, message: appErr.message, details: appErr.details, requestId },
    };
    return c.json(body, statusForCode[appErr.code] as ContentfulStatusCode);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
