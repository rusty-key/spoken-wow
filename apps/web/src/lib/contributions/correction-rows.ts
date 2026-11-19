/**
 * The corrections among a section's rows: contributions for a quest moment or book page the corpus
 * already has, whose text says something else. Each carries the corpus wordings it could replace
 * and the player's text, for CorrectionTable.
 *
 * Built from the rows and line states the contributions page has already read
 * (listedWithPending), so showing corrections beside the new lines costs no second listing.
 */
import "server-only";

import type { CorrectionRow, CorrectionSource } from "@/components/CorrectionTable";
import { explorerHref } from "@/lib/links";
import { observedFrom } from "@/lib/npc/resolve";

import { classWordMarks, isMarked } from "./class-words";
import { clientOf, matchesClient } from "./client";
import { readable } from "./compare";
import { tabOf, type LineState } from "./known";
import { momentOf } from "./naming";
import { matchesSearch, matchesStage, type ClientFilter, type StageFilter } from "./query";
import { readerGenderOf, readerKey, readersOf } from "./readers";
import { observationMeta, type Contribution } from "./store";
import { questFor } from "./triage";
import type { Filter } from "@/lib/search";

export async function correctionRowsFor({
  listed,
  states,
  source,
  client,
  stage,
  q,
  searchIn,
}: {
  listed: Contribution[];
  states: LineState[];
  source: CorrectionSource;
  client: ClientFilter;
  stage: StageFilter;
  q: string;
  searchIn: Filter;
}): Promise<CorrectionRow[]> {
  const candidates = listed.flatMap((row, index) => {
    const state = states[index];
    return state.kind === "changed" && tabOf(row.status, state) === "corrections" ? [{ row, state }] : [];
  });
  if (candidates.length === 0) return [];
  const [marks, readers] = await Promise.all([
    classWordMarks(candidates.map(({ row }) => row)),
    source === "quests"
      ? readersOf(candidates.flatMap(({ row, state }) => state.wordings.map((line) => ({ ...line, lang: row.locale }))))
      : new Map(),
  ]);

  return candidates.flatMap(({ row, state }) => {
    if (!matchesClient(clientOf(row.build).family, client)) return [];
    const quest = source === "quests" ? questFor(row) : null;
    if (source === "quests" && !matchesStage(quest, stage)) return [];
    const observed = observedFrom(observationMeta(row));
    const npc = observed.npcId === null ? null : { npcId: observed.npcId, npcName: observed.npcName };
    const wordings = state.wordings.map((line) => ({
      lineId: line.lineId,
      variant: line.variant,
      editHref: explorerHref(source, line.lineId),
      before: readable(line.text),
      split: momentOf(line.lineId) !== line.lineId,
      readBy: readers.get(readerKey(row.locale, line.lineId, line.variant)) ?? [],
    }));
    const corpusText = wordings.map((line) => line.before).join("\n");
    // Readables have no NPC or quest, so a number there is text to find, not an id.
    const searchedIn = source === "readables" ? "text" : searchIn;
    if (!matchesSearch({ text: `${row.text ?? ""}\n${corpusText}`, npc: npc ?? undefined, quest }, q, searchedIn)) return [];
    return [
      {
        id: row.id,
        wordings,
        closest: state.closest,
        quest: quest === "gossip" || quest === null ? null : { ...quest, classWord: isMarked(marks, row) },
        title: source === "readables" ? bookTitleOf(row.meta) : null,
        client: clientOf(row.build),
        locale: row.locale,
        count: row.count,
        createdAt: row.createdAt,
        status: row.status,
        npc,
        after: row.text ?? "",
        readerGender: readerGenderOf(row.meta),
        body: row.body,
        rejectReason: row.rejectReason,
      },
    ];
  });
}

/** The title and page number a client showed a book page under. */
function bookTitleOf(meta: Record<string, string>): string | null {
  const title = meta.book?.trim();
  if (!title) return null;
  return meta.number ? `${title} p.${meta.number}` : title;
}
