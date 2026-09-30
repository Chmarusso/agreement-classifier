import { AppError } from "./errors.ts";
import type { EventPayload, NewEvent, StoredEvent } from "./events.ts";
import { ev } from "./user.ts";

export type ExtractionStatus = "pending" | "extracted" | "failed";

export interface AgreementState {
  exists: boolean;
  extraction: ExtractionStatus;
}

export const initialAgreementState = (): AgreementState => ({ exists: false, extraction: "pending" });

export function evolveAgreement(state: AgreementState, e: StoredEvent | NewEvent): AgreementState {
  switch (e.type) {
    case "AgreementUploaded":
      return { exists: true, extraction: "pending" };
    case "AgreementTextExtracted":
      return { ...state, extraction: "extracted" };
    case "AgreementTextExtractionFailed":
      return { ...state, extraction: "failed" };
    default:
      return state;
  }
}

export type AgreementCommand =
  | ({ type: "UploadAgreement" } & EventPayload<"AgreementUploaded">)
  | ({ type: "RecordExtraction" } & EventPayload<"AgreementTextExtracted">)
  | ({ type: "RecordExtractionFailure" } & EventPayload<"AgreementTextExtractionFailed">)
  | ({ type: "RecordAnonymization" } & EventPayload<"AgreementAnonymized">)
  | { type: "ViewAgreement" }
  | { type: "DownloadAgreement" }
  | { type: "PreviewAgreement" };

export function decideAgreement(state: AgreementState, cmd: AgreementCommand): NewEvent[] {
  if (cmd.type === "UploadAgreement") {
    if (state.exists) throw new AppError("CONFLICT", "Agreement already exists.");
    const { type: _t, ...payload } = cmd;
    return [ev("AgreementUploaded", payload)];
  }
  if (!state.exists) throw new AppError("NOT_FOUND", "Agreement not found.");
  switch (cmd.type) {
    case "RecordExtraction": {
      const { type: _t, ...payload } = cmd;
      return [ev("AgreementTextExtracted", payload)];
    }
    case "RecordExtractionFailure": {
      const { type: _t, ...payload } = cmd;
      return [ev("AgreementTextExtractionFailed", payload)];
    }
    case "RecordAnonymization": {
      if (state.extraction === "failed") throw new AppError("CONFLICT", "Text extraction failed for this agreement.");
      const { type: _t, ...payload } = cmd;
      return [ev("AgreementAnonymized", payload)];
    }
    case "ViewAgreement":
      return [ev("AgreementViewed", {})];
    case "DownloadAgreement":
      return [ev("AgreementDownloaded", {})];
    case "PreviewAgreement":
      return [ev("AgreementPreviewed", {})];
  }
}
