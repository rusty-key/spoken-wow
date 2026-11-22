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
import type { CorpusLine } from "../corpus";
import { madeByOf } from "../takes/made-by";
import { liveTakes, teamLiveTakes } from "../takes/store";
import { dirtyQuestFiles } from "./dirtiness";
import { staleAmong } from "./staleness";
import type { SearchContext } from "../search";
import { NO_CONTEXT } from "../search";
import { readAs, type TeamId } from "../teams/store";
import { publishedOverrides, teamLiveOverrides } from "../teams/viewing";
import { readIgnores } from "./ignores";
import { questLevels } from "./levels";
import { confirmedSightings } from "./sightings";
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
 *   take. Nobody else gets the map, so no route can hand an author's name to a visitor, nor an
 *   override no live take speaks yet (publishedOverrides).
 * @param levels whether a level bound is in force. Reads the whole table, so only those searches pay.
 * @param index the file index of a corpus the caller already read, which saves its stamp check.
 */
export async function searchContext(
  outdated = false,
  dirty = false,
  lang: Lang = BASE_LANG,
  seesMadeBy = false,
  levels = false,
  index?: Map<string, CorpusLine>,
): Promise<{ voiced: Set<string>; context: SearchContext }> {
  const live = await liveTakes("quests", lang);
  const voiced = new Set(live.map((row) => row.file));
  const takes = new Map(live.map((row) => [row.file, { version: row.version, takes: row.takes }]));
  const generatedAt = new Map(live.map((row) => [row.file, row.createdAt.getTime()]));
  const madeBy = seesMadeBy ? new Map(live.map((row) => [row.file, madeByOf(row)])) : undefined;

  try {
    // All per language: a take is compared with its own language's text and lexicon.
    const [overrides, ignores, reports, dirt, questLevelsByQuest, sightings] = await Promise.all([
      readOverrides(lang),
      readIgnores(lang),
      openReports(lang),
      dirty ? dirtyQuestFiles(undefined, lang, undefined, index) : null,
      levels ? questLevels() : null,
      // Kept a minute, and already read for the facets of this same request.
      confirmedSightings(),
    ]);
    // From the live takes and overrides just read, rather than a second query for both.
    const stale = outdated ? await staleAmong(live, lang, overrides, index) : null;
    return {
      voiced,
      context: {
        overrides: seesMadeBy ? overrides : await publishedOverrides(lang, overrides),
        ignores,
        reports,
        levels: questLevelsByQuest ?? undefined,
        sightings,
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

/**
 * What a quests search may know of another team: its live takes and the overrides they speak,
 * none of its ignores, reports or made-by. Nothing reads as stale or dirty, since that would need
 * its private rows, so a voiced file reads as current.
 *
 * @param levels whether a level bound is in force; the levels are shared, not the team's.
 */
export async function publicSearchContext(
  lang: Lang,
  team: TeamId,
  levels = false,
): Promise<{ voiced: Set<string>; context: SearchContext }> {
  const [live, overrides, questLevelsByQuest, sightings] = await Promise.all([
    teamLiveTakes(team, "quests", lang),
    teamLiveOverrides(team, "quests", lang),
    levels ? questLevels() : null,
    confirmedSightings(),
  ]);
  return {
    voiced: new Set(live.map((row) => row.file)),
    context: {
      ...NO_CONTEXT,
      // No original hash, so none reads as drifted, and no line id, which only a drifted one shows.
      overrides: new Map(
        [...overrides].map(([file, text]) => [
          file,
          { file, lineId: "", text, updatedAt: "", updatedBy: null, originalHash: null },
        ]),
      ),
      takes: new Map(live.map((row) => [row.file, { version: row.version, takes: 1 }])),
      generatedAt: new Map(live.map((row) => [row.file, row.createdAt.getTime()])),
      stale: new Set(),
      dirty: new Set(),
      levels: questLevelsByQuest ?? undefined,
      sightings,
    },
  };
}
