import { AnonymizationConfig, AuditModelConfig, type NewEvent, type StoredEvent } from "./events.ts";
import { ev } from "./user.ts";

/** The single System stream that holds application settings. */
export const SETTINGS_STREAM_ID = "00000000-0000-4000-8000-000000000001";
/** Anonymization settings have their own stream, so saving them never conflicts with an audit model edit. */
export const ANONYMIZATION_SETTINGS_STREAM_ID = "00000000-0000-4000-8000-000000000002";

/** The full pipeline: every type, every technique, the service's default NER models. */
export const defaultAnonymizationConfig = (keep: string[] = []): AnonymizationConfig => ({
  disabledLabels: [],
  personCues: true,
  propagate: true,
  inflection: true,
  ner: true,
  nerModels: { pl: null, en: null },
  keep,
});

export interface SettingsState {
  /** Admin-chosen audit model, or null when the environment default applies. */
  auditModel: AuditModelConfig | null;
  /** Admin-chosen anonymization, or null for the defaults. */
  anonymization: AnonymizationConfig | null;
}

export const initialSettingsState = (): SettingsState => ({ auditModel: null, anonymization: null });

export function evolveSettings(state: SettingsState, e: StoredEvent | NewEvent): SettingsState {
  switch (e.type) {
    case "AuditModelConfigured":
      return { ...state, auditModel: AuditModelConfig.parse(e.payload) };
    case "AuditModelReset":
      return { ...state, auditModel: null };
    case "AnonymizationConfigured":
      return { ...state, anonymization: AnonymizationConfig.parse(e.payload) };
    case "AnonymizationReset":
      return { ...state, anonymization: null };
    default:
      return state;
  }
}

export type SettingsCommand =
  | { type: "ConfigureAuditModel"; config: AuditModelConfig; label: string }
  | { type: "ResetAuditModel"; label: string }
  | { type: "ConfigureAnonymization"; config: AnonymizationConfig }
  | { type: "ResetAnonymization" };

const same = (a: AuditModelConfig | null, b: AuditModelConfig) =>
  a !== null && a.provider === b.provider && a.model === b.model && a.reasoning === b.reasoning;

export function decideSettings(state: SettingsState, cmd: SettingsCommand): NewEvent[] {
  switch (cmd.type) {
    case "ConfigureAuditModel":
      return same(state.auditModel, cmd.config) ? [] : [ev("AuditModelConfigured", { ...cmd.config, label: cmd.label })];
    case "ResetAuditModel":
      return state.auditModel === null ? [] : [ev("AuditModelReset", { label: cmd.label })];
    case "ConfigureAnonymization":
      return JSON.stringify(state.anonymization) === JSON.stringify(cmd.config) ? [] : [ev("AnonymizationConfigured", cmd.config)];
    case "ResetAnonymization":
      return state.anonymization === null ? [] : [ev("AnonymizationReset", {})];
  }
}
