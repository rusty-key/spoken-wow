/** A team being deleted makes nothing (migration 0124's team_not_deleting). */

/** The SQLSTATE team_not_deleting raises. */
export const TEAM_DELETING = "SPTD1";

/** The refusal to show when `error` is a write under a team being deleted; null for any other error. */
export function deletingRefusal(error: unknown): string | null {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code !== TEAM_DELETING || typeof message !== "string") return null;
  return `${message}; it can make nothing more.`;
}
