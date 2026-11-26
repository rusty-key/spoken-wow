import "server-only";

import { INT32_MAX } from "@/lib/npc/npc";
import { NPC_ROW_KINDS, resolutionKey, type NpcResolution, type NpcRowKind } from "@/lib/npc/store";

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

const ID = /^([a-z]+):(\d+)$/;

/** `creature:123` as its kind and id, or null for anything the npc table cannot hold. */
export function parseNpcId(id: string): { npcKind: NpcRowKind; npcId: number } | null {
  const match = ID.exec(id);
  if (!match || !(NPC_ROW_KINDS as readonly string[]).includes(match[1])) return null;
  const npcId = Number(match[2]);
  return npcId <= INT32_MAX ? { npcKind: match[1] as NpcRowKind, npcId } : null;
}

export const NO_LANGUAGE_DIRECTION = "English uses the global direction";
