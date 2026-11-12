import { readLexicon } from "@/lib/generation/dictionary";
import { LexiconError } from "@/lib/generation/lexicon";
import { MAX_ITEMS } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { validateItems } from "@/lib/text-api/lexicon";
import { expectedVersionOf, lexiconState, writeEntries } from "@/lib/text-api/lexicon-write";
import { invalid } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request);
  if (denied) return denied;

  for (const name of new URL(request.url).searchParams.keys()) return invalid(`unknown parameter ${name}`);

  const lexicon = await readLexicon(context.lang);
  return Response.json({ lang: context.lang, ...lexiconState(lexicon), entries: lexicon.entries });
}

/** All or nothing: the lexicon is one document, so one bad item refuses the request. */
export async function PATCH(request: Request) {
  const { context, denied } = await requireToken(request, { write: true, also: "configure" });
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid("send JSON with an items array");
  }
  const { items } = body as { items?: unknown };
  if (!Array.isArray(items)) return invalid("send JSON with an items array");
  if (items.length === 0) return invalid("items is empty");
  if (items.length > MAX_ITEMS) return invalid(`at most ${MAX_ITEMS} items per update`);

  const expectedVersion = expectedVersionOf(body as Record<string, unknown>);
  if (expectedVersion instanceof Response) return expectedVersion;

  let entries;
  try {
    entries = validateItems(items);
  } catch (error) {
    if (error instanceof LexiconError) return invalid(error.message);
    throw error;
  }

  const written = await writeEntries(context, entries, expectedVersion);
  if (written instanceof Response) return written;
  return Response.json({ ...written.body, results: written.results });
}
