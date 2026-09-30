import { AppError } from "./errors.ts";
import type { EventPayload, NewEvent, Role, StoredEvent } from "./events.ts";

export interface UserState {
  exists: boolean;
  email: string | null;
  role: Role | null;
  status: "active" | "deactivated";
}

export const initialUserState = (): UserState => ({ exists: false, email: null, role: null, status: "active" });

export function evolveUser(state: UserState, event: StoredEvent | NewEvent): UserState {
  switch (event.type) {
    case "UserRegistered":
      return { ...state, exists: true, email: event.payload.email, role: event.payload.role };
    case "UserRoleChanged":
      return { ...state, role: event.payload.newRole };
    case "UserDeactivated":
      return { ...state, status: "deactivated" };
    case "UserReactivated":
      return { ...state, status: "active" };
    default:
      return state;
  }
}

export type UserCommand =
  | { type: "RegisterUser"; email: string; displayName: string; role: Role; invitedBy: string | null }
  | { type: "ChangeUserRole"; role: Role }
  | { type: "DeactivateUser"; reason: string | null }
  | { type: "ReactivateUser" };

export const ev = <T extends NewEvent["type"]>(type: T, payload: EventPayload<T>) => ({ type, payload }) as NewEvent;

/** Pure decision function for the User stream (profile, role, status). */
export function decideUser(state: UserState, cmd: UserCommand): NewEvent[] {
  if (cmd.type === "RegisterUser") {
    if (state.exists) throw new AppError("CONFLICT", "User already exists.");
    return [
      ev("UserRegistered", {
        email: cmd.email.toLowerCase(),
        displayName: cmd.displayName,
        role: cmd.role,
        invitedBy: cmd.invitedBy,
      }),
    ];
  }
  if (!state.exists) throw new AppError("NOT_FOUND", "User not found.");

  switch (cmd.type) {
    case "ChangeUserRole":
      if (state.role === cmd.role) return [];
      return [ev("UserRoleChanged", { oldRole: state.role!, newRole: cmd.role })];
    case "DeactivateUser":
      if (state.status === "deactivated") return [];
      return [ev("UserDeactivated", { reason: cmd.reason })];
    case "ReactivateUser":
      if (state.status === "active") return [];
      return [ev("UserReactivated", {})];
  }
}
