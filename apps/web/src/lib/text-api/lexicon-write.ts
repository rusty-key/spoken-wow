/**
 * A lexicon write over /api/v1, shared by the one-entry and the many-entry route.
 *
 * The upload uses the token owner's ElevenLabs key. Without one the save still lands and reads
 * as pending, so someone with a key can upload it from the site.
 */
import "server-only";

import { readApiKey } from "@/lib/api-key";
import { editLexicon, LexiconConflict, type EffectiveLexicon } from "@/lib/generation/dictionary";
import { LexiconError, type LexiconEntry } from "@/lib/generation/lexicon";

import type { TokenContext } from "./guard";
import { upsertEntries } from "./lexicon";
import { invalid } from "./respond";

export function lexiconState(lexicon: EffectiveLexicon) {
  return { version: lexicon.version, sync: lexicon.sync, updatedAt: lexicon.updatedAt };
}

/**
 * A write's body: the JSON object, its expectedVersion, and the entries `toEntries` makes of
 * it. A 400 for anything malformed, including a LexiconError from `toEntries`.
 */
export async function readWrite(
  request: Request,
  toEntries: (body: Record<string, unknown>) => LexiconEntry[] | Response,
): Promise<{ entries: LexiconEntry[]; expectedVersion: string | undefined } | Response> {
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
    return { entries, expectedVersion: expectedVersion ?? undefined };
  } catch (error) {
    if (error instanceof LexiconError) return invalid(error.message);
    throw error;
  }
}

export async function writeEntries(
  context: TokenContext,
  { entries, expectedVersion }: { entries: LexiconEntry[]; expectedVersion: string | undefined },
) {
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
    return { lang: context.lang, ...lexiconState(lexicon), syncError, results: result };
  } catch (error) {
    if (!(error instanceof LexiconConflict)) throw error;
    return Response.json({ error: error.message, version: error.version }, { status: 409 });
  }
}
