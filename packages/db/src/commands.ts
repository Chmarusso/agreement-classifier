import {
  type AgreementCommand,
  type AgreementState,
  type AuditRunCommand,
  type AuditRunState,
  type AuthCommand,
  type AuthState,
  ConcurrencyError,
  decideAgreement,
  decideAuditRun,
  decideAuth,
  decideRule,
  decideSettings,
  decideUser,
  type EventMetadata,
  evolveAgreement,
  evolveAuditRun,
  evolveAuth,
  evolveRule,
  evolveSettings,
  evolveUser,
  initialAgreementState,
  initialAuditRunState,
  initialAuthState,
  initialRuleState,
  initialSettingsState,
  initialUserState,
  type NewEvent,
  type RuleCommand,
  type RuleState,
  readEventTypes,
  type SettingsCommand,
  type SettingsState,
  type StoredEvent,
  type StreamType,
  type UserCommand,
  type UserState,
} from "@app/domain";
import type { Db, Tx } from "./client.ts";
import { appendToStream, readStream } from "./event-store.ts";

export interface Aggregate<S, C> {
  streamType: StreamType;
  initial: () => S;
  evolve: (state: S, event: StoredEvent) => S;
  decide: (state: S, command: C) => NewEvent[];
}

export const UserAggregate: Aggregate<UserState, UserCommand> = {
  streamType: "User",
  initial: initialUserState,
  evolve: evolveUser,
  decide: decideUser,
};

export const AuthAggregate: Aggregate<AuthState, AuthCommand> = {
  streamType: "UserAuth",
  initial: initialAuthState,
  evolve: evolveAuth,
  decide: decideAuth,
};

export const RuleAggregate: Aggregate<RuleState, RuleCommand> = {
  streamType: "Rule",
  initial: initialRuleState,
  evolve: evolveRule,
  decide: decideRule,
};

export const AgreementAggregate: Aggregate<AgreementState, AgreementCommand> = {
  streamType: "Agreement",
  initial: initialAgreementState,
  evolve: evolveAgreement,
  decide: decideAgreement,
};

export const AuditRunAggregate: Aggregate<AuditRunState, AuditRunCommand> = {
  streamType: "AuditRun",
  initial: initialAuditRunState,
  evolve: evolveAuditRun,
  decide: decideAuditRun,
};

export const SettingsAggregate: Aggregate<SettingsState, SettingsCommand> = {
  streamType: "System",
  initial: initialSettingsState,
  evolve: evolveSettings,
  decide: decideSettings,
};

export async function loadAggregate<S, C>(tx: Tx | Db, agg: Aggregate<S, C>, id: string) {
  const history = await readStream(tx, agg.streamType, id);
  const state = history.reduce(agg.evolve, agg.initial());
  // View and download events never change state, so they must not invalidate an editor's version.
  const writeVersion = history.reduce((v, e) => (readEventTypes.has(e.type) ? v : e.streamVersion), 0);
  return { state, version: history.length, writeVersion };
}

export interface CommandResult {
  events: StoredEvent[];
  version: number;
}

/**
 * Load → decide → append in one transaction. When `expectedVersion` is given
 * and differs from the version of the last state-changing event, the command
 * is rejected with 409 before deciding. That is how clients get optimistic
 * concurrency on edits. Read events are ignored, so viewing never causes a conflict.
 */
export async function executeCommand<S, C>(
  db: Db,
  agg: Aggregate<S, C>,
  id: string,
  command: C,
  metadata: EventMetadata,
  opts: { expectedVersion?: number; tx?: Tx } = {},
): Promise<CommandResult> {
  const run = async (tx: Tx) => {
    const { state, version, writeVersion } = await loadAggregate(tx, agg, id);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== writeVersion) {
      throw new ConcurrencyError(agg.streamType, id, opts.expectedVersion);
    }
    const newEvents = agg.decide(state, command);
    const stored = await appendToStream(tx, {
      streamType: agg.streamType,
      streamId: id,
      expectedVersion: version,
      events: newEvents,
      metadata,
    });
    return { events: stored, version: version + stored.length };
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}
