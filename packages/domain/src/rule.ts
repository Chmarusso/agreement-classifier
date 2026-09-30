import { AppError } from "./errors.ts";
import type { NewEvent, RuleContent, StoredEvent } from "./events.ts";
import { ev } from "./user.ts";

export interface RuleState {
  exists: boolean;
  status: "active" | "archived";
  content: RuleContent | null;
}

export const initialRuleState = (): RuleState => ({ exists: false, status: "active", content: null });

export function evolveRule(state: RuleState, e: StoredEvent | NewEvent): RuleState {
  switch (e.type) {
    case "RuleCreated": {
      const { slug: _slug, ...content } = e.payload;
      return { exists: true, status: "active", content };
    }
    case "RuleUpdated": {
      const { changedFields: _c, ...content } = e.payload;
      return { ...state, content };
    }
    case "RuleArchived":
      return { ...state, status: "archived" };
    case "RuleRestored":
      return { ...state, status: "active" };
    default:
      return state;
  }
}

export type RuleCommand =
  | ({ type: "CreateRule"; slug: string } & RuleContent)
  | ({ type: "UpdateRule" } & RuleContent)
  | { type: "ArchiveRule"; reason: string | null }
  | { type: "RestoreRule" }
  | { type: "ViewRule" };

const fields = ["title", "description", "severity", "category", "appliesTo", "languages"] as const;

export function decideRule(state: RuleState, cmd: RuleCommand): NewEvent[] {
  if (cmd.type === "CreateRule") {
    if (state.exists) throw new AppError("CONFLICT", "Rule already exists.");
    const { type: _t, ...payload } = cmd;
    return [ev("RuleCreated", payload)];
  }
  if (!state.exists || !state.content) throw new AppError("NOT_FOUND", "Rule not found.");
  switch (cmd.type) {
    case "UpdateRule": {
      if (state.status === "archived") throw new AppError("CONFLICT", "Restore the rule before editing it.");
      const { type: _t, ...next } = cmd;
      const changedFields = fields.filter((f) => JSON.stringify(next[f]) !== JSON.stringify(state.content![f]));
      if (changedFields.length === 0) return [];
      return [ev("RuleUpdated", { ...next, changedFields })];
    }
    case "ArchiveRule":
      return state.status === "archived" ? [] : [ev("RuleArchived", { reason: cmd.reason })];
    case "RestoreRule":
      return state.status === "active" ? [] : [ev("RuleRestored", {})];
    case "ViewRule":
      return [ev("RuleViewed", {})];
  }
}
