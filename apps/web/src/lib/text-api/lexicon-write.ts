/**
 * A lexicon write over /api/v1, shared by the one-entry and the many-entry route.
 *
 * The upload uses the token owner's ElevenLabs key. Without one the save still lands and reads
 * as pending, so someone with a key can upload it from the site.
 */
import "server-only";

import { readApiKey } from "@/lib/api-key";
import { editLexicon, LexiconConflict, NO_KEY_TO_SYNC, type EffectiveLexicon } from "@/lib/generation/dictionary";
import { LexiconError, type LexiconEntry } from "@/lib/generation/lexicon";

import type { TokenContext } from "./guard";
import { upsertEntries } from "./lexicon";
import { invalid } from "./respond";

export function lexiconState(lexicon: EffectiveLexicon) {
  return { version: lexicon.version, sync: lexicon.sync, updatedAt: lexicon.updatedAt };
}

/** Worded as the site's requireApiKey words it: SPOKEN_SECRET_KEY changed under the stored key. */
const UNREADABLE_KEY = "saved, but not uploaded: your stored ElevenLabs key could not be read. Set it again in your profile.";

type Write = { entries: LexiconEntry[]; expectedVersion: string | null | undefined };

/**
 * A write's body: the JSON object, its expectedVersion (null: the lexicon must still have no
 * row), and the entries `toEntries` makes of it. A 400 for anything malformed, including a
 * LexiconError from `toEntries`.
 */
export async function readWrite(
  request: Request,
  toEntries: (body: Record<string, unknown>) => LexiconEntry[] | Response,
): Promise<Write | Response> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("send a JSON object");
  const fields = body as Record<string, unknown>;

  const { expectedVersion } = fields;
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "string") {
    return invalid("expectedVersion must be a string");
  }

  try {
    const entries = toEntries(fields);
    if (entries instanceof Response) return entries;
    return { entries, expectedVersion };
  } catch (error) {
    if (error instanceof LexiconError) return invalid(error.message);
    throw error;
  }
}

export async function writeEntries(
  context: TokenContext,
  { entries, expectedVersion }: Write,
) {
  // A key that will not decrypt saves as pending, as no key does, but says which it was.
  let apiKey: string | undefined;
  let unreadable = false;
  try {
    apiKey = (await readApiKey(context.userId)) ?? undefined;
  } catch {
    unreadable = true;
  }
  try {
    const { lexicon, syncError, result } = await editLexicon(
      context.lang,
      (current) => upsertEntries(current, entries),
      context.userId,
      { apiKey },
      expectedVersion,
    );
    return {
      lang: context.lang,
      ...lexiconState(lexicon),
      syncError: unreadable && syncError === NO_KEY_TO_SYNC ? UNREADABLE_KEY : syncError,
      results: result,
    };
  } catch (error) {
    if (!(error instanceof LexiconConflict)) throw error;
    return Response.json({ error: error.message, version: error.version }, { status: 409 });
  }
}
