import { AppError } from "@app/domain";
import type { z } from "zod";
import type { Ctx } from "./context.ts";

function toAppError(error: z.ZodError): AppError {
  return new AppError(
    "VALIDATION_FAILED",
    "Some fields are invalid.",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

export async function parseJson<S extends z.ZodTypeAny>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw toAppError(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodTypeAny>(c: Ctx, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw toAppError(result.error);
  return result.data;
}

export function parseUuidParam(c: Ctx, name: string): string {
  const v = c.req.param(name) ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new AppError("NOT_FOUND", "Not found.");
  }
  return v;
}

/** ?view=original (default) or ?view=anonymized. */
export function parseTextView(v: string | undefined): "original" | "anonymized" {
  if (v === undefined || v === "original" || v === "anonymized") return v ?? "original";
  throw new AppError("VALIDATION_FAILED", "view must be original or anonymized.", [{ path: "view", message: "Invalid value" }]);
}
