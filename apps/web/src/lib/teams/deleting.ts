/** The SQLSTATE team_not_deleting raises. */
export const TEAM_DELETING = "SPTD1";

/** The refusal to show when `error` is a write under a team being deleted; null for any other error. */
export function deletingRefusal(error: unknown): string | null {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code !== TEAM_DELETING || typeof message !== "string") return null;
  return `${message}; it can make nothing more.`;
}

/** The 409 answering a write under a team being deleted, `extra` added to its body; null for any other error. */
export function deletingResponse(error: unknown, extra: Record<string, unknown> = {}): Response | null {
  const refusal = deletingRefusal(error);
  return refusal === null ? null : Response.json({ error: refusal, ...extra }, { status: 409 });
}
