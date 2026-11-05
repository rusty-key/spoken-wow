/**
 * Which expansion a quest line belongs to, derived from what the tables already know.
 *
 * The site voices Classic: Era, Forever and Season of Discovery. TBC lines reach the tables all
 * the same, from players on TBC Anniversary and from Wowhead's TBC pages, and are kept, but the
 * explorer hides them until TBC is supported (`tbc=1` brings them back).
 *
 * DERIVED, NOT STORED. A line is written by four accept paths and gets a new version on every
 * edit, and a stored flag would have to be carried by each of them. Instead it is read off two
 * facts no writer has to remember:
 *
 *   * A quest the Classic extract (vmangos) has no row for, with an id below TBC_QUEST_CEILING,
 *     is TBC: the extract ends at 9665, TBC's quests run from 8326 (Sunstrider Isle) to the
 *     11000s, Season of Discovery's are 78000-79999 and Forever's own from 80000 up. This is the
 *     one rule that catches the Wowhead imports, whose envelopes all say a Forever build.
 *   * Gossip, which has no quest id to go by, every speaker of which a TBC Anniversary client
 *     sent (contribution `build` 2.5.x). Not applied to quests: Anniversary also sends the
 *     Classic quests it still has, and those stay Classic. Gossip imported from
 *     Wowhead's TBC pages carries a Forever build and is not caught; it reads as Classic.
 *
 * Node-free, so the tests need no database; lib/quests/catalogue.ts loads the two facts.
 */
import type { CorpusLine } from "@/lib/corpus";
import { clientOf, type ClientFamily } from "@/lib/contributions/client";

/** Above every TBC quest id and below Season of Discovery's. */
export const TBC_QUEST_CEILING = 13000;

export type ExpansionFacts = {
  /** Every quest id the Classic extract has a row for, in any language. */
  extractedQuests: ReadonlySet<number>;
  /** Each contribution's client family, by contribution id. */
  contributionClients: ReadonlyMap<number, ClientFamily>;
};

/** A contribution's family from the `build` it was sent with. */
export function familyOfBuild(build: string | null | undefined): ClientFamily {
  return clientOf(build).family;
}

function questIsTbc(questId: number | null, facts: ExpansionFacts): boolean {
  return questId !== null && questId < TBC_QUEST_CEILING && !facts.extractedQuests.has(questId);
}

/**
 * Marks every TBC row `expansion: "tbc"`, in place: the rows are the catalogue build's own. A
 * gossip line's rows are its speakers, so its rule looks at all of a line id's rows at once.
 */
export function markExpansions(lines: CorpusLine[], facts: ExpansionFacts): CorpusLine[] {
  const allTbcClient = new Map<string, boolean>();
  for (const line of lines) {
    if (line.questId !== null) continue;
    const id = line.contributionId;
    const tbc = id != null && facts.contributionClients.get(id) === "anniversary";
    allTbcClient.set(line.lineId, (allTbcClient.get(line.lineId) ?? true) && tbc);
  }
  for (const line of lines) {
    const tbc = line.questId === null ? allTbcClient.get(line.lineId) : questIsTbc(line.questId, facts);
    if (tbc) line.expansion = "tbc";
  }
  return lines;
}
