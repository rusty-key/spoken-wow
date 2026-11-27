/**
 * Who may use /voices/design's routes, decided on the server whatever the page drew.
 *
 * Designing and reviewing are `configure` in the language (an admin decision): the result is a
 * slot's voice, which is the language's to decide. Hearing what was designed is open to whoever
 * may see /voices.
 */
import "server-only";

import { requireCapability, type Session } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { UPSTREAM_FAILED } from "@/lib/upstream-failed";

export async function requireDesigner(
  request: Request,
): Promise<{ session: NonNullable<Session>; lang: Lang; denied: null } | { session: null; lang: null; denied: Response }> {
  const { lang, denied } = await langParam(request);
  if (denied) return { session: null, lang: null, denied };
  const guard = await requireCapability("configure", lang);
  if (guard.denied) return { session: null, lang: null, denied: guard.denied };
  return { session: guard.session, lang, denied: null };
}

/** A failure the caller can act on, said as is; anything else is the provider's or ours. */
export class DesignError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function failed(error: unknown): Response {
  if (error instanceof DesignError) return Response.json({ error: error.message }, { status: error.status });
  // The page shows only the message; the stack is what finds the call in the pm2 log.
  console.error("[voice-design]", error);
  return Response.json({ error: (error instanceof Error ? error.message || error.name : String(error)) || "unknown error" }, { status: UPSTREAM_FAILED });
}
