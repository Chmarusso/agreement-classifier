import { type Database } from "@app/db";
import type { EventMetadata, Role } from "@app/domain";
export declare const seedUsers: {
  email: string;
  displayName: string;
  role: Role;
}[];
export declare const seedMeta: () => EventMetadata;
/** Idempotent: existing emails are skipped. Goes through command handlers so events exist. */
export declare function seedAllUsers(database: Database): Promise<{
  created: string[];
  skipped: string[];
}>;
