/**
 * The Postgres-backed maps a quests search needs, fetched together and never fatally.
 *
 * The explorer used to read the corpus and the audio store off disk on purpose: a database outage
 * takes accounts and regeneration with it, but browsing and playback keep working
 * (deploy/README.md). Overrides arrived after that promise was made and must not quietly
 * withdraw it - so a failure here degrades to an un-overridden search rather than a 500 on
 * the one page that was supposed to stay up.
 *
 * THAT PROMISE IS WEAKENING, DELIBERATELY. The corpus itself is moving into Postgres, where
 * the places and readables corpora already live, and a section whose words come from a table
 * cannot browse without it - those two answer an outage with a "corpus empty" page rather
 * than with stale prose. The fail-soft below is kept while the corpus is still a file, and
 * the day it is not, this function becomes the place to decide deliberately what an outage
 * looks like here. It should not simply rot into a catch that hides the new failure.
 *
 * The cost of being wrong is small and visible in the right direction: a rewritten line
 * reads as its corpus text. Nothing is generated from this - regenerate.ts reads the
 * override itself, and there a failure *should* be fatal.
 */
import { madeByOf } from "../takes/made-by";
import { liveTakes } from "../takes/store";
import { dirtyQuestFiles } from "./dirtiness";
import { staleFiles } from "./staleness";
import type { SearchContext } from "../search";
import { NO_CONTEXT } from "../search";
import { readAs } from "../teams/store";
import { readIgnores } from "./ignores";
import { readOverrides } from "./overrides";
import { BASE_LANG, type Lang } from "../lang";

/**
 * lineId -> how many reports about it are still open.
 *
 * Grouped in the database rather than counted here, and `lineId is not null` excludes a
 * report about the project, which belongs to no line. The same query the places and readables
 * catalogues run; the count is public while the bodies are not, so a row can say "somebody
 * has already reported this one" without showing what they said.
 */
async function openReports(lang: Lang): Promise<Map<string, number>> {
  const rows = await readAs<{ lineId: string; open: number }>(
    lang,
    `select "lineId", count(*)::int as "open"
       from "report"
      where "source" = 'quests' and "status" = 'open' and "lineId" is not null
        and "lang" = $1
      group by "lineId"`,
    [lang],
  );
  return new Map(rows.map((row) => [row.lineId, row.open]));
}

/**
 * Everything a quests search reads from the database: which files have a live take, and
 * the context the rows are marked from.
 *
 * The live takes are fetched ONCE and everything about them derived from those rows -- the
 * voiced set, the take count, the generation date. Each used to be its own call to the same
 * eleven-thousand-row query, so a search paid for it two or three times.
 *
 * The voiced set is not fail-soft, and is fetched outside the catch for that reason: a
 * search that cannot tell which lines have audio has nothing honest to show, where a
 * missing override or report count only leaves a row unmarked.
 *
 * @param outdated whether the audio-outdated filter is in force. One query and a sha-256
 *   per take, paid for only by the searches that ask.
 * @param dirty whether the pronunciation filter is in force. The same bargain.
 * @param seesMadeBy whether the viewer works in the language, and so may know who made each
 *   take. Nobody else gets the map, so no route can hand an author's name to a visitor.
 */
export async function searchContext(
  outdated = false,
  dirty = false,
  lang: Lang = BASE_LANG,
  seesMadeBy = false,
): Promise<{ voiced: Set<string>; context: SearchContext }> {
  const live = await liveTakes("quests", lang);
  const voiced = new Set(live.map((row) => row.file));
  const takes = new Map(live.map((row) => [row.file, { version: row.version, takes: row.takes }]));
  const generatedAt = new Map(live.map((row) => [row.file, row.createdAt.getTime()]));
  const madeBy = seesMadeBy ? new Map(live.map((row) => [row.file, madeByOf(row)])) : undefined;

  try {
    // All per language: a take is compared with its own language's text and lexicon.
    const [overrides, ignores, reports, stale, dirt] = await Promise.all([
      readOverrides(lang),
      readIgnores(lang),
      openReports(lang),
      outdated ? staleFiles(undefined, lang) : null,
      dirty ? dirtyQuestFiles(undefined, lang) : null,
    ]);
    return {
      voiced,
      context: {
        overrides,
        ignores,
        reports,
        takes,
        generatedAt,
        madeBy,
        stale: stale ?? undefined,
        dirty: dirt ?? undefined,
      },
    };
  } catch (error) {
    console.warn("[quests] search context unavailable, serving unmarked results:", error);
    return { voiced, context: { ...NO_CONTEXT, takes, generatedAt, madeBy } };
  }
}
