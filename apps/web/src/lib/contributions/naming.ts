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
 * No player-gender branch: naming.py's `:{m|f}` suffix exists for a template the game expands
 * differently per player gender, and a contribution carries no such variant -- the client
 * already picked one side of any `$G` (see the accept.ts docstring).
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

/**
 * The ElevenLabs voice name for a race, gender and flavor -- mirrors flavors.py's voice_name,
 * not naming.py, but kept beside it: the same "this side must agree with the Python" rule
 * applies, just to a name tts_cli/voices.py resolves rather than a file the addon looks up.
 */
export function voiceNameFor(race: string, gender: string, flavor: string | null): string {
  return flavor ? `${race}-${gender}-${flavor}` : `${race}-${gender}`;
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
