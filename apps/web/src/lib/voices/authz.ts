/**
 * The access boundary for the voice routes.
 *
 * Every /api/voices route calls one of these. The role checks in components only decide what
 * to draw — see canRegenerate's comment in permissions.ts — so the server check cannot be
 * skipped just because the UI would not have offered the control.
 *
 * Two levels, as on the page. Changing what a voice is made from — its clips, its fish.audio
 * reference — is shared by everybody who generates with it in the language, so it is
 * canManageVoices: the language's admin, or a global one. Hearing
 * those sources and cloning them into one's own ElevenLabs account touch nobody else, so they
 * are open to whoever spends in the language (canViewVoices).
 *
 * 403 rather than /voices' 404: hiding a page from a member is worth doing, but pretending
 * an API route does not exist only makes a real misconfiguration harder to diagnose.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { canManageVoices, canViewVoices } from "@/lib/permissions";
import { isVoiceSlot } from "./slots";

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * Somebody who may change the request's language's voice sources, and the session saying
 * who: every change to a voice's sources is written to the activity log under whoever made it.
 */
export async function requireVoiceManager(
  request: Request,
  voice?: string,
): Promise<{ session: Session; lang: Lang; denied: null } | { session: null; lang: null; denied: Response }> {
  const refuse = (denied: Response) => ({ session: null, lang: null, denied });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return refuse(FORBIDDEN());
  const { lang, denied } = await langParam(request);
  if (denied) return refuse(denied);
  if (!canManageVoices(await viewerOf(session), lang)) return refuse(FORBIDDEN());
  const unknown = await unknownVoice(voice, lang);
  if (unknown) return refuse(unknown);
  return { session, lang, denied: null };
}

/**
 * The session and the request's language, for somebody who spends in it.
 *
 * `manager` says whether they may also change the sources, for a route that does both
 * reading and recording provenance.
 */
export async function requireVoiceViewer(
  request: Request,
  voice?: string,
): Promise<
  | { session: Session; lang: Lang; manager: boolean; denied: null }
  | { session: null; lang: null; manager: false; denied: Response }
> {
  const refuse = (denied: Response) => ({ session: null, lang: null, manager: false as const, denied });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return refuse(FORBIDDEN());
  const { lang, denied } = await langParam(request);
  if (denied) return refuse(denied);
  const viewer = await viewerOf(session);
  if (!canViewVoices(viewer, lang)) return refuse(FORBIDDEN());
  const unknown = await unknownVoice(voice, lang);
  if (unknown) return refuse(unknown);
  return { session, lang, manager: canManageVoices(viewer, lang), denied: null };
}

// Checked after the session so an unauthorized caller cannot use the response to learn which
// voice names exist.
async function unknownVoice(voice: string | undefined, lang: Lang): Promise<Response | null> {
  if (voice === undefined || (await isVoiceSlot(voice, lang))) return null;
  return Response.json({ error: `unknown voice ${voice}` }, { status: 404 });
}
