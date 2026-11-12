/**
 * A lexicon write over /api/v1, shared by the one-entry and the many-entry route.
 *
 * The upload uses the token owner's ElevenLabs key. Without one the save still lands and reads
 * as pending, so someone with a key can upload it from the site.
 */
import "server-only";

import { readApiKey } from "@/lib/api-key";
import { editLexicon, LexiconConflict, readLexicon, type EffectiveLexicon } from "@/lib/generation/dictionary";
import type { LexiconEntry } from "@/lib/generation/lexicon";

import type { TokenContext } from "./guard";
import { upsertEntries, type EntryResult } from "./lexicon";
import { invalid } from "./respond";

export function lexiconState(lexicon: EffectiveLexicon) {
  return { version: lexicon.version, sync: lexicon.sync, updatedAt: lexicon.updatedAt };
}

/** The expectedVersion a body carries, undefined when absent, or a 400. */
export function expectedVersionOf(body: Record<string, unknown>): string | undefined | Response {
  const value = body.expectedVersion;
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : invalid("expectedVersion must be a string");
}

export async function writeEntries(
  context: TokenContext,
  entries: LexiconEntry[],
  expectedVersion: string | undefined,
): Promise<{ results: EntryResult[]; body: Record<string, unknown> } | Response> {
  // A key that will not decrypt is no key: the save stays pending, as without one.
  const apiKey = (await readApiKey(context.userId).catch(() => null)) ?? undefined;
  try {
    const { lexicon, syncError, result } = await editLexicon(
      context.lang,
      (current) => upsertEntries(current, entries),
      context.userId,
      { apiKey },
      expectedVersion,
    );
    return { results: result, body: { lang: context.lang, ...lexiconState(lexicon), syncError } };
  } catch (error) {
    if (!(error instanceof LexiconConflict)) throw error;
    const { version } = await readLexicon(context.lang);
    return Response.json({ error: error.message, version }, { status: 409 });
  }
}
