/**
 * The places explorer's only read.
 *
 * The URL carries `page`, not `offset`, so a shared link survives a change to PAGE_SIZE.
 * The arithmetic stays here.
 */
import { langParam, worksHere } from "@/lib/lang-server";
import { recordingsFor } from "@/lib/recordings/store";
import { catalogue, isCorpusEmpty, loadContext } from "@/lib/places/catalogue";
import { filtersFromParams, PAGE_SIZE } from "@/lib/places/filters";
import { search } from "@/lib/places/search";

export const dynamic = "force-dynamic";

/**
 * 503, not 500, when the corpus has not been seeded.
 *
 * CorpusEmpty is deliberately loud -- the zones site used to fall back to the committed Lua
 * here, which rendered a full catalogue against a database that could not save a word of it,
 * and reported that only when somebody pressed save. But "nobody has run the import yet" is
 * a deployment state rather than a defect, and it is the state this section is in between a
 * fresh deployment and its cutover. A bare 500 says neither, and a monitor cannot tell it
 * from a crash.
 */
function corpusEmpty(error: unknown): Response {
  return Response.json(
    { error: (error as Error).message, code: "corpus_empty" },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  const filters = filtersFromParams(params);
  // English, until the site has a language selector again. The library below takes a
  const page = Math.max(1, Number(params.get("page")) || 1);
  // Who made each take is for the people working in the language. For anybody else the
  // filters are dropped rather than left to match nothing, so a translator's link still
  // shows a visitor the lines.
  const seesMadeBy = await worksHere(lang);
  if (!seesMadeBy) {
    filters.model = undefined;
    filters.author = undefined;
  }

  let entries;
  let context;
  try {
    let recordings;
    [entries, context, recordings] = await Promise.all([
      catalogue(lang),
      loadContext(lang, seesMadeBy),
      recordingsFor("places", lang),
    ]);
    // Dropped for anybody who may not see recordings, as the made-by filters are above.
    if (!recordings) filters.recorded = undefined;
    context = { ...context, recordings };
  } catch (error) {
    if (isCorpusEmpty(error)) return corpusEmpty(error);
    throw error;
  }

  // "Regenerate everything this filter matches" needs every matching id, not a page of
  // rows. Ids only: the corpus is ~1,400 lines and the queue re-derives the rest from them.
  if (params.get("ids") === "1") {
    const all = search(entries, context, filters, 0, Number.MAX_SAFE_INTEGER);
    return Response.json({
      ids: all.lines.map((line) => line.id),
      // The files of the matching lines that are dirty, for "clear all": the mark is keyed
      // on the recording, and a page of rows cannot name what the rest of the filter holds.
      dirtyFiles: all.lines.filter((line) => line.dirty).map((line) => line.file),
      total: all.total,
      // Summed here rather than in the browser: the confirmation dialog needs the character
      // total to quote a cost, and this query has already counted it.
      totalChars: all.totalChars,
    });
  }

  return Response.json(search(entries, context, filters, (page - 1) * PAGE_SIZE, PAGE_SIZE));
}
