/**
 * TypeScript mirror of pipelines/quests/tts_cli/naming.py, for the one place this app must
 * mint a line id and file name itself: writing an accepted contribution into the quest tables
 * (accept.ts).
 *
 * THE TWO MUST AGREE EXACTLY -- naming.py's own docstring says a filename off by one
 * character addresses a file the addon can never find, and fails silently. The same drift
 * hazard AGENTS.md documents for addons/Spoken_Books/Checksum.lua: two independent
 * implementations of one frozen format, pinned together by tests on both sides rather than
 * shared code, because one is Python and the other TypeScript.
 *
 * naming.py's `:{m|f}` suffix exists for a text that branches on the player's gender (`$G`).
 * Each language decides it from its own text (playerGenderForms), so one moment can be a
 * plain line in one language and two in another.
 */
import { createHash } from "node:crypto";

export type QuestEvent = "accept" | "progress" | "complete";

export const QUEST_EVENTS: readonly QuestEvent[] = ["accept", "progress", "complete"];

/** md5(originalText + race + gender), unprefixed -- get_hash/templateText_race_gender_hash. */
export function gossipHash(originalText: string, race: string, gender: string): string {
  return createHash("md5").update(originalText + race + gender).digest("hex");
}

export function questLineId(questId: number, event: QuestEvent): string {
  return `q:${questId}:${event}`;
}

/**
 * Whether a line id answers a quest moment (`q:{questId}:{event}`), in any of its forms: the bare
 * id, or naming.py's per-player-gender `:m`/`:f` variants. A contribution names a quest and a
 * moment and nothing finer, so "is this line already there?" is asked by quest id and moment
 * alone -- tables that only carry the gendered variants still have the line.
 */
export function answersQuestMoment(lineId: string, momentId: string): boolean {
  return lineId === momentId || lineId.startsWith(`${momentId}:`);
}

/** A line id without its `:m`/`:f` player-gender suffix: the moment its forms share in every language. */
export function momentOf(lineId: string): string {
  return lineId.replace(/:[mf]$/, "");
}

/** momentOf in SQL, for a `lineId` column. */
export function momentSql(column: string): string {
  return `regexp_replace(${column}, ':[mf]$', '')`;
}

/**
 * The lines a language's text makes of a moment: one, or one per player gender where the text
 * branches on `$G`. The plain form is what an ungendered language plays to every player; the
 * addon tries the player's `m-`/`f-` file first and falls back to the plain one.
 */
export function playerGenderForms(
  moment: string,
  fileName: string,
  gendered: boolean,
): { lineId: string; fileName: string; playerGender: "m" | "f" | null }[] {
  if (!gendered) return [{ lineId: moment, fileName, playerGender: null }];
  return (["m", "f"] as const).map((g) => ({ lineId: `${moment}:${g}`, fileName: `${g}-${fileName}`, playerGender: g }));
}

/**
 * answersQuestMoment in SQL, for a `lineId` column and a moment expression. Three exact ids
 * rather than a `like` prefix, so Postgres can look them up in quest_line's lineId indexes.
 */
export function answersQuestMomentSql(column: string, moment: string): string {
  return `${column} = any(array[${moment}, ${moment} || ':m', ${moment} || ':f'])`;
}

export function questFileName(questId: number, event: QuestEvent): string {
  return `${questId}-${event}`;
}

export function gossipLineId(hash: string): string {
  return `g:${hash}`;
}

/** filename_for_row's gossip branch: the bare hash, unprefixed. */
export function gossipFileName(hash: string): string {
  return hash;
}

/** broadcast_gossip_stem: a gossip line minted from its BroadcastText id and whole voice. */
export function broadcastGossipStem(broadcastTextId: number, voice: string): string {
  return `b${broadcastTextId}-${voice}`;
}

/** localized_gossip_stem: a gossip line minted in a language with neither English nor an id. */
export function localizedGossipStem(lang: string, textHash: string): string {
  return `${lang}-${textHash}`;
}

/** gossip_stem_rank: 0 broadcast, 1 English hash, 2 localized; the order one moment's stems are preferred in. */
export function gossipStemRank(stem: string): 0 | 1 | 2 {
  if (stem.startsWith("b") && stem.includes("-")) return 0;
  return stem.includes("-") ? 2 : 1;
}

/**
 * A line in one more voice than its file was made in, and that voice's file: naming.py's
 * variant_line_id and variant_file_name. The plain id keeps the voice its file was made in.
 */
export function variantLineId(lineId: string, voice: string): string {
  return `${lineId}~${voice}`;
}

export function variantFileName(fileName: string, voice: string): string {
  return `${fileName}-${voice}`;
}

/** The line a voice's line is of: naming.py's split_voice. Text and ignores are the line's. */
export function baseLineId(lineId: string): string {
  const at = lineId.indexOf("~");
  return at < 0 ? lineId : lineId.slice(0, at);
}

export type LineIdentity = {
  source: string;
  lineId: string;
  fileName: string;
  questId: number | null;
  questTitle: string | null;
};

/**
 * The lineId/fileName a quests contribution would resolve to, given a resolved race and
 * gender -- pure, so a read path (page.tsx, deciding whether "Add to explorer" still belongs
 * on an accepted row) can ask the same question accept.ts's prepareLine does without the DB
 * access prepareLine's own collision checks need. Null for the shapes prepareLine refuses as
 * "malformed": a quest event outside QUEST_EVENTS, or a gossip contribution with no text.
 *
 * Not the gossip collision check itself (accept.ts's own normaliseText comparison) -- that
 * decides whether a *fresh* hash collides with an *existing* corpus line despite differing
 * whitespace, which only matters when writing. This just answers "what id would this text
 * hash to", the same computation either side of that decision needs.
 */
export function lineIdentityFor(
  meta: Record<string, string>,
  text: string | null,
  race: string,
  gender: string,
): LineIdentity | null {
  const { quest, event, title } = meta;
  if (quest && event) {
    if (!(QUEST_EVENTS as readonly string[]).includes(event)) return null;
    const questId = Number(quest);
    const questEvent = event as QuestEvent;
    return {
      source: questEvent,
      lineId: questLineId(questId, questEvent),
      fileName: questFileName(questId, questEvent),
      questId,
      questTitle: title ?? null,
    };
  }

  if (!text) return null;
  const hash = gossipHash(text, race, gender);
  return {
    source: "gossip",
    lineId: gossipLineId(hash),
    fileName: gossipFileName(hash),
    questId: null,
    questTitle: null,
  };
}
