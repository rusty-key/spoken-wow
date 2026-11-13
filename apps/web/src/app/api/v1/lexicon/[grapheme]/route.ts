import { readLexicon } from "@/lib/generation/dictionary";
import { validateEntry } from "@/lib/generation/lexicon";
import { requireToken } from "@/lib/text-api/guard";
import { findEntry } from "@/lib/text-api/lexicon";
import { lexiconState, readWrite, writeEntries } from "@/lib/text-api/lexicon-write";
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
  const { context, denied } = await requireToken(request, { need: "write", also: "configure" });
  if (denied) return denied;

  const grapheme = decodeId((await params).grapheme);
  const write = await readWrite(request, (body) =>
    // The mass update reads it from the item, so an agent may send it here too, and a different
    // one would leave it unclear which word is meant.
    "grapheme" in body && body.grapheme !== grapheme
      ? invalid("the grapheme goes in the URL here")
      : [validateEntry({ ...body, grapheme })],
  );
  if (write instanceof Response) return write;

  const written = await writeEntries(context, write);
  if (written instanceof Response) return written;
  const { results, ...state } = written;
  return Response.json({ ...state, entry: write.entries[0], status: results[0].status });
}
