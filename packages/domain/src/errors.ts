export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "BRIDGE_UNAVAILABLE"
  | "INTERNAL";

export const statusForCode: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  BRIDGE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

/** An error the API turns into the standard error envelope. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Raised when an append's expectedVersion no longer matches the stream. */
export class ConcurrencyError extends AppError {
  constructor(
    readonly streamType: string,
    readonly streamId: string,
    readonly expectedVersion: number,
  ) {
    super("CONFLICT", `${streamType} ${streamId} was changed by someone else. Reload and try again.`);
    this.name = "ConcurrencyError";
  }
}
