/**
 * The access boundary for the generation routes.
 *
 * The sibling of lib/voices/authz.ts and 403 for the same reason: the role checks in
 * components only decide what to draw, so the server check cannot be skipped just because
 * the UI would not have offered the control.
 *
 * Two levels. Regenerating and reverting are a language grant; changing the global settings
 * is `admin`, because those settings apply to everything anyone generates afterwards.
 */
import { headers } from "next/headers";

import { readApiKey } from "@/lib/api-key";
import { PROVIDER_NAME, type Provider } from "@/lib/generation/providers";
import { readPreference } from "@/lib/generation/preference";
import { speakerFrom } from "@/lib/generation/speakers/for";
import type { Speaker } from "@/lib/generation/speakers/speaker";
import { auth } from "@/lib/auth";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { NO_API_KEY } from "@/lib/no-api-key";
import { currentSession } from "@/lib/session";
import { viewerOf } from "@/lib/grants/store";
import {
  can,
  canConfigureGeneration,
  isAdmin,
  langsWhere,
  spendsCredits,
  type Capability,
} from "@/lib/permissions";

export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * The session, or a 403 to return.
 *
 * Returns the session rather than just a verdict because every caller needs the user id for
 * provenance, and fetching it twice would mean two session lookups per regenerated line.
 */
export async function requireRegenerate(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  return requireCapability("regenerate", BASE_LANG);
}

/**
 * The session, or a 403, for one capability in one language.
 *
 * lib/permissions.ts's `can`, over the grants the viewer holds.
 */
export async function requireCapability(
  capability: Capability,
  lang: Lang,
): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await currentSession();
  if (!session || !can(await viewerOf(session), capability, lang)) {
    return { session: null, denied: FORBIDDEN() };
  }
  return { session, denied: null };
}

export async function requireConfigure(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canConfigureGeneration(session.user.role)) {
    return { session: null, denied: FORBIDDEN() };
  }
  return { session, denied: null };
}

/**
 * The session, or a 403, for what only a global admin may do: say who an NPC is, and edit the
 * types an NPC can be. An NPC's type and voice hold in every language, so no language grant is
 * enough to set them.
 */
export async function requireAdminSession(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) return { session: null, denied: FORBIDDEN() };
  return { session, denied: null };
}

/**
 * requireAdminSession, with the page's language (`?lang=`): a rename is saved in it, and the
 * activity log files the answer under it.
 */
export async function requireAdmin(
  request: Request,
): Promise<
  | { lang: Lang; session: NonNullable<Session>; denied: null }
  | { lang: null; session: null; denied: Response }
> {
  const { lang, denied } = await langParam(request);
  if (denied) return { lang: null, session: null, denied };
  const guard = await requireAdminSession();
  if (guard.denied) return { lang: null, session: null, denied: guard.denied };
  return { lang, session: guard.session, denied: null };
}

//------------------------------------------------------------------------------
// Credentials
//------------------------------------------------------------------------------

/**
 * The session of somebody who spends somewhere, or null: the gate on the routes that store a
 * key or a collaborator's generator settings. Somewhere includes a language grant -- a
 * translator who may regenerate Portuguese pays with their own key like anybody else.
 */
export async function currentSpender() {
  const session = await currentSession();
  return session && spendsCredits(await viewerOf(session)) ? session : null;
}

export type KeyGuard = { key: string; denied: null } | { key: null; denied: Response };

function noKey(message: string): Response {
  return Response.json({ error: message, code: "no_api_key" }, { status: NO_API_KEY });
}

/**
 * The signed-in user's own key for a provider, for the routes that spend.
 *
 * Run AFTER a role guard, never instead of one: a key is a credential, not a permission,
 * and a member who pasted one must still be refused.
 *
 * There is no fallback to a server-wide ELEVENLABS_API_KEY, deliberately. With one, "who
 * paid for this line" would have no answer, and granting somebody regenerate in a language
 * would quietly grant them the deployer's bill as well. fish.audio has none for the same
 * reason.
 */
export async function requireApiKey(
  userId: string,
  provider: Provider = "elevenlabs",
): Promise<KeyGuard> {
  const name = PROVIDER_NAME[provider];
  let key: string | null;
  try {
    key = await readApiKey(userId, provider);
  } catch {
    // A row that will not open means SPOKEN_SECRET_KEY changed under it. Saving the key
    // again is the fix, so this points at the same page as having none at all -- but it
    // says which of the two happened.
    return {
      key: null,
      denied: noKey(`Your stored ${name} key could not be read. Set it again in your profile.`),
    };
  }

  if (!key) {
    return {
      key: null,
      denied: noKey(
        provider === "elevenlabs"
          ? "This spends ElevenLabs credits, and you have no key set."
          : "This spends from your fish.audio balance, and you have no fish.audio key set.",
      ),
    };
  }

  return { key, denied: null };
}

export type SpeakerGuard =
  | { speaker: Speaker; provider: Provider; key: string; denied: null }
  | { speaker: null; provider: Provider; key: null; denied: Response };

/**
 * The signed-in user's Speaker: the provider they activated for `lang` on /voices, with their
 * own key for it. The 428 names that provider, so a collaborator who switched to fish.audio
 * without a key is told which key is missing.
 */
export async function requireSpeaker(userId: string, lang: Lang): Promise<SpeakerGuard> {
  const preference = await readPreference(userId, lang);
  const { key, denied } = await requireApiKey(userId, preference.provider);
  if (denied) return { speaker: null, provider: preference.provider, key: null, denied };
  return {
    speaker: speakerFrom(preference.provider, key, preference),
    provider: preference.provider,
    key,
    denied: null,
  };
}

//------------------------------------------------------------------------------
// Language
//------------------------------------------------------------------------------


/**
 * A route acting in one language: the language from `?lang=`, and the session if it holds
 * `capability` there. Parsed in that order because what someone may do depends on where.
 */
export async function requireIn(
  request: Request,
  capability: Capability,
): Promise<
  | { lang: Lang; session: NonNullable<Session>; denied: null }
  | { lang: null; session: null; denied: Response }
> {
  const { lang, denied } = await langParam(request);
  if (denied) return { lang: null, session: null, denied };
  const guard = await requireCapability(capability, lang);
  if (guard.denied) return { lang: null, session: null, denied: guard.denied };
  return { lang, session: guard.session, denied: null };
}

/**
 * The session, or a 403, for anybody who regenerates in any language, with those languages.
 *
 * For what is shared between them: there is one queue, and somebody queueing Portuguese is
 * watching the same panel as somebody queueing English. The languages are what the caller
 * may act on in it -- Stop cancels those and no others.
 */
export async function requireAnyRegenerate(): Promise<
  | { session: NonNullable<Session>; langs: Lang[]; denied: null }
  | { session: null; langs: null; denied: Response }
> {
  const session = await currentSession();
  const langs = langsWhere(await viewerOf(session), "regenerate");
  if (!session || langs.length === 0) return { session: null, langs: null, denied: FORBIDDEN() };
  return { session, langs, denied: null };
}
