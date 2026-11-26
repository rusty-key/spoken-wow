import "server-only";

import { BASE_LANG, type Lang } from "@/lib/lang";
import { listLanguageDirections, resolutionKey, type NpcResolution } from "@/lib/npc/store";

export type NpcItem = {
  id: string;
  name: string | null;
  race: string | null;
  gender: string | null;
  flavor: string | null;
  /** The global direction, English's own. */
  direction: string | null;
  /** The token's language's own, over the global one; always null in English, which has none. */
  languageDirection: string | null;
};

export function npcItem(npc: NpcResolution, own: Map<string, string>): NpcItem {
  const id = resolutionKey(npc.npcKind, npc.npcId);
  return {
    id,
    name: npc.npcName,
    race: npc.race,
    gender: npc.gender,
    flavor: npc.flavor,
    direction: npc.direction ?? null,
    languageDirection: own.get(id) ?? null,
  };
}

/** The language's own directions; English has none, its direction being the global one. */
export async function languageDirectionsOf(lang: Lang): Promise<Map<string, string>> {
  return lang === BASE_LANG ? new Map() : listLanguageDirections(lang);
}
