/**
 * The readables explorer's only read.
 *
 * The URL carries `page`, not `offset`, so a shared link survives a change to PAGE_SIZE.
 * The arithmetic stays here. Shaped on the places route, including the 503 below.
 */
import { catalogue, isCorpusEmpty, loadContext } from "@/lib/readables/catalogue";
import { langParam, worksHere } from "@/lib/lang-server";
import { recordingsFor } from "@/lib/recordings/store";
import { filtersFromParams, PAGE_SIZE } from "@/lib/readables/filters";
import { search } from "@/lib/readables/search";

export const dynamic = "force-dynamic";

/**
 * 503, not 500, when the corpus has not been seeded.
 *
 * "Nobody has run the import yet" is a deployment state rather than a defect, and it is the
 * state this section is in on any database that has the migration and no rows. A bare 500
 * says neither, and a monitor cannot tell it from a crash.
 */
function corpusEmpty(error: unknown): Response {
  return Response.json({ error: (error as Error).message, code: "corpus_empty" }, { status: 503 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersFromParams(params);
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  const page = Math.max(1, Number(params.get("page")) || 1);
  // Who made each take is for the people working in the language. For anybody else the
  // filters are dropped rather than left to match nothing, so a translator's link still
  // shows a visitor the lines.
  const seesMadeBy = await worksHere(lang);
  if (!seesMadeBy) {
    filters.model = undefined;
    filters.author = undefined;
  }

  let pages;
  let context;
  try {
    let recordings;
    [pages, context, recordings] = await Promise.all([
      catalogue(lang),
      loadContext(lang, seesMadeBy),
      recordingsFor("readables", lang),
    ]);
    // Dropped for anybody who may not see recordings, as the made-by filters are above.
    if (!recordings) filters.recorded = undefined;
    context = { ...context, recordings };
  } catch (error) {
    if (isCorpusEmpty(error)) return corpusEmpty(error);
    throw error;
  }

  // "Regenerate everything this filter matches" needs every matching id, not a page of
  // rows. Ids only: the queue re-derives the rest from them.
  if (params.get("ids") === "1") {
    const all = search(pages, context, filters, 0, Number.MAX_SAFE_INTEGER);
    return Response.json({
      // Only voiceable pages: the other 88 are in the corpus because the game has them,
      // and quoting a cost for text nothing can speak would be a bill for silence.
      ids: all.lines.filter((line) => line.generatable).map((line) => line.id),
      // The files of the matching pages that are dirty, for "clear all": the mark is keyed
      // on the recording, and a page of rows cannot name what the rest of the filter holds.
      // Unfiltered by `generatable`, unlike the ids: a page nothing will voice can still
      // carry audio made before the lexicon moved.
      dirtyFiles: all.lines.filter((line) => line.dirty).map((line) => line.file),
      total: all.total,
      totalChars: all.lines
        .filter((line) => line.generatable)
        .reduce((sum, line) => sum + line.chars, 0),
    });
  }

  return Response.json(search(pages, context, filters, (page - 1) * PAGE_SIZE, PAGE_SIZE));
}
