import { readLexicon } from "@/lib/generation/dictionary";
import { LexiconError, validateEntry } from "@/lib/generation/lexicon";
import { requireToken } from "@/lib/text-api/guard";
import { findEntry } from "@/lib/text-api/lexicon";
import { expectedVersionOf, lexiconState, writeEntries } from "@/lib/text-api/lexicon-write";
import { decodeId, invalid } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ grapheme: string }> };

export async function GET(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request);
  if (denied) return denied;

  const grapheme = decodeId((await params).grapheme);
  const lexicon = await readLexicon(context.lang);
  const entry = findEntry(lexicon.entries, grapheme);
  if (!entry) return Response.json({ error: `no entry for ${grapheme}` }, { status: 404 });
  return Response.json({ lang: context.lang, ...lexiconState(lexicon), entry });
}

/** Replace the entry, or add it. The URL's spelling becomes the stored one. */
export async function PATCH(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request, { write: true, also: "configure" });
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid("send a JSON object");
  }
  const grapheme = decodeId((await params).grapheme);
  // The mass update reads it from the item, so an agent may send it here too, and a different
  // one would leave it unclear which word is meant.
  if ("grapheme" in body && body.grapheme !== grapheme) return invalid("the grapheme goes in the URL here");

  const expectedVersion = expectedVersionOf(body as Record<string, unknown>);
  if (expectedVersion instanceof Response) return expectedVersion;

  let entry;
  try {
    entry = validateEntry({ ...body, grapheme }, 0);
  } catch (error) {
    if (error instanceof LexiconError) return invalid(error.message.replace(/^entry 0: /, ""));
    throw error;
  }

  const written = await writeEntries(context, [entry], expectedVersion);
  if (written instanceof Response) return written;
  return Response.json({ ...written.body, entry, status: written.results[0].status });
}
