/**
 * Which game client a quest line came from, derived from what the tables already know.
 *
 * The site voices Era and Forever (FOCUS_FAMILIES, lib/contributions/client.ts). Other clients
 * send lines too -- TBC Anniversary, the 1.12, 2.4.3 and 3.3.5a legacy clients, retail -- and
 * those are accepted and kept, but the explorer, a queued batch and the Missing audio ranking
 * leave them out unless a `client` filter asks for them: the same bins the Contributions pages
 * use, with Era + Forever the default.
 *
 * DERIVED, NOT STORED. A line is written by four accept paths and gets a new version on every
 * edit, and a stored column would have to be carried by each of them. Instead each row is
 * read off facts no writer has to remember:
 *
 *   * A row whose speaker the extract wrote has no client: it is the game data, and belongs with
 *     the focus bin (matchesClient's null). So does every row of a quest the extract has, whoever
 *     sent its speaker: TBC Anniversary and the legacy clients still have Classic's quests, and
 *     an Era player hears them.
 *   * Any other row whose speaker a contribution wrote is that contribution's client, from its
 *     `build`. A contribution with no build (an old envelope) is with the focus bin too: nothing
 *     says it came from elsewhere. A line is the client of whoever sent it first, since a later
 *     identical upload only counts on that row (submission.ts's dedup keeps no build).
 *   * Except a quest the Classic extract (vmangos) has no row for, with an id below
 *     TBC_QUEST_CEILING, which is TBC Anniversary whatever sent it: the extract ends at 9665,
 *     TBC's quests run from 8326 (Sunstrider Isle) to the 11000s, Season of Discovery's are
 *     78000-79999 and Forever's own from 80000 up. Wowhead's TBC pages came in through envelopes
 *     that all say a Forever build, and this is the one rule that catches them. Gossip has no
 *     quest id, so gossip scraped from those pages still reads as Forever.
 *
 * Node-free, so the tests need no database; lib/quests/catalogue.ts loads the facts.
 */
import type { CorpusLine } from "@/lib/corpus";
import { clientOf, matchesClient, type ClientFamily, type ClientFilter } from "@/lib/contributions/client";

/** Above every TBC quest id and below Season of Discovery's. */
export const TBC_QUEST_CEILING = 13000;

export type LineClientFacts = {
  /** Every quest id the Classic extract has a row for, in any language. */
  extractedQuests: ReadonlySet<number>;
  /** Each contribution's `build`, by contribution id. */
  contributionBuilds: ReadonlyMap<number, string>;
};

function familyOf(line: CorpusLine, facts: LineClientFacts): ClientFamily | null {
  const { questId } = line;
  if (questId !== null && facts.extractedQuests.has(questId)) return null;
  if (questId !== null && questId < TBC_QUEST_CEILING) return "anniversary";
  const id = line.contributionId;
  if (id == null) return null;
  const client = clientOf(facts.contributionBuilds.get(id));
  return client.version === null ? null : client.family;
}

/** Sets every row's `clientFamily`, in place: the rows are the catalogue build's own. */
export function markClients(lines: CorpusLine[], facts: LineClientFacts): CorpusLine[] {
  for (const line of lines) {
    const family = familyOf(line, facts);
    if (family) line.clientFamily = family;
  }
  return lines;
}

/** Whether a row is in view under `filter`; a row the extract wrote is with the focus bin. */
export function lineMatchesClient(line: Pick<CorpusLine, "clientFamily">, filter: ClientFilter): boolean {
  return matchesClient(line.clientFamily ?? null, filter);
}
