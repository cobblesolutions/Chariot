/**
 * Chariot staff role model.
 *
 * `broker_ceo` is full-access (equivalent to the previous "admin" tier).
 * `case_manager`, `completions_manager`, and `adviser` are all limited-access
 * staff (equivalent to the previous "worker" tier) that additionally differ
 * in whose case pipeline they may view via `alsoViewsUserId`.
 *
 * Mirrored in the frontend at src/lib/roles.ts — keep both in sync.
 */
export const STAFF_ROLES = [
  "broker_ceo",
  "case_manager",
  "completions_manager",
  "adviser",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type Role = StaffRole | "client";

export const ROLE_LABELS: Record<StaffRole, string> = {
  broker_ceo: "Mortgage Broker · CEO",
  case_manager: "Case Manager",
  completions_manager: "Completions Manager",
  adviser: "Mortgage Adviser",
};

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Full access — sees every case, client, and setting. */
export function isFullAccess(role: string): boolean {
  return role === "broker_ceo";
}
