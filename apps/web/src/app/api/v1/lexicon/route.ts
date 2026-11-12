import { readLexicon } from "@/lib/generation/dictionary";
import { validateLexicon } from "@/lib/generation/lexicon";
import { MAX_ITEMS } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { lexiconState, readWrite, writeEntries } from "@/lib/text-api/lexicon-write";
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

  const write = await readWrite(request, ({ items }) => {
    if (!Array.isArray(items)) return invalid("send JSON with an items array");
    if (items.length === 0) return invalid("items is empty");
    if (items.length > MAX_ITEMS) return invalid(`at most ${MAX_ITEMS} items per update`);
    // The site's whole-lexicon check: every entry valid, no grapheme twice ignoring case.
    return validateLexicon(items);
  });
  if (write instanceof Response) return write;

  const written = await writeEntries(context, write);
  return written instanceof Response ? written : Response.json(written);
}
