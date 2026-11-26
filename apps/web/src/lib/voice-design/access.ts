/**
 * Who may use /voices/design's routes, decided on the server whatever the page drew.
 *
 * Designing and reviewing are `configure` in the language (an admin decision): the result is a
 * slot's voice, which is the language's to decide. Hearing what was designed is open to whoever
 * may see /voices.
 */
import "server-only";

import { readApiKey, type KeyProvider } from "@/lib/api-key";
import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { can, canViewVoices, isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

type Session = NonNullable<Awaited<ReturnType<typeof currentSession>>>;

export type Access = { session: Session; lang: Lang; admin: boolean; denied: null } | { session: null; lang: null; admin: false; denied: Response };

const refuse = (denied: Response): Access => ({ session: null, lang: null, admin: false, denied });
const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

async function guard(request: Request, allowed: (viewer: Awaited<ReturnType<typeof viewerOf>>, lang: Lang) => boolean): Promise<Access> {
  const session = await currentSession();
  if (!session) return refuse(FORBIDDEN());
  const { lang, denied } = await langParam(request);
  if (denied) return refuse(denied);
  if (!allowed(await viewerOf(session), lang)) return refuse(FORBIDDEN());
  return { session, lang, admin: isAdmin(session.user.role), denied: null };
}

export function requireDesigner(request: Request): Promise<Access> {
  return guard(request, (viewer, lang) => can(viewer, "configure", lang));
}

export function requireDesignViewer(request: Request): Promise<Access> {
  return guard(request, (viewer, lang) => canViewVoices(viewer, lang));
}

/** The caller's key, or the 400 that sends them to their profile for it. */
export async function keyOrRefusal(
  userId: string,
  provider: KeyProvider,
): Promise<{ key: string; denied: null } | { key: null; denied: Response }> {
  const key = await readApiKey(userId, provider).catch(() => null);
  if (key) return { key, denied: null };
  return {
    key: null,
    denied: Response.json({ error: `add your ${provider === "gemini" ? "Gemini" : "ElevenLabs"} key on your profile first`, key: provider }, { status: 400 }),
  };
}

/** A failure the caller can act on, said as is; anything else is the provider's or ours. */
export class DesignError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function failed(error: unknown): Response {
  if (error instanceof DesignError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
}
