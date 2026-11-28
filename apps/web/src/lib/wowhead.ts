/**
 * Links out to Wowhead's Forever database.
 *
 * `/forever/` is the branch the addon's clients run on. The bare `/quest=` path is retail, where
 * a vanilla quest may have been changed out of recognition or removed, and `/classic/` has never
 * heard of post-vanilla content such as NPC 205729, a quest-giver the corpus has no line for. Both
 * would mislead on exactly the lines worth looking up: the ones that look wrong here.
 *
 * `npcType` is the corpus's own word for which id space an entity lives in, and Wowhead
 * spells two of the three differently. Mapped in one place rather than at each call site,
 * because creature 68 is a Stormwind City Guard and gameobject 68 is a Wanted Poster - a
 * wrong segment silently opens the wrong page rather than a missing one.
 *
 * A page links in its own language, so a maintainer reads the quest the way their client shows it.
 * English is the bare path, and a language Wowhead has no edition of falls back to it rather than
 * to a 404. Both Spanish clients share Wowhead's one Spanish edition.
 *
 * No node imports: the row renders in the browser.
 */
import type { Lang } from "./lang";
import type { NpcType } from "./line-fields";

const SEGMENT: Record<NpcType, string> = {
  creature: "npc",
  gameobject: "object",
  item: "item",
};

const EDITION: Record<string, string> = {
  deDE: "de",
  esES: "es",
  esMX: "es",
  frFR: "fr",
  itIT: "it",
  ptBR: "pt",
  ruRU: "ru",
  koKR: "ko",
  zhCN: "cn",
  zhTW: "tw",
};

function base(lang: Lang): string {
  const edition = EDITION[lang];
  return edition ? `https://www.wowhead.com/forever/${edition}` : "https://www.wowhead.com/forever";
}

export function wowheadQuestUrl(lang: Lang, questId: number): string {
  return `${base(lang)}/quest=${questId}`;
}

export function wowheadEntityUrl(lang: Lang, npcType: NpcType, npcId: number): string {
  return `${base(lang)}/${SEGMENT[npcType]}=${npcId}`;
}
