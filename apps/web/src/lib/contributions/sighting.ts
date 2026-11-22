/**
 * Where a player met an NPC, as the addon keeps it: one `seen` envelope per NPC, naming it and
 * every zone map (uiMapID) its quest or gossip window opened in (addons/Spoken_Quests/Contribute.lua,
 * SeeSpeaker). They sit in the same saved variables file as the lines and go up with them.
 *
 * Browser-safe, as envelope.ts is: the upload page counts them before anything is sent.
 */
import type { Envelope } from "./envelope";

export type Sighting = { npcType: "creature" | "gameobject"; npcId: number; zones: number[] };

/** SeeSpeaker's MAX_ZONES. More is a list nobody's game wrote. */
const MAX_ZONES = 8;

// npc_sighting's columns are 32-bit: a bigger id is no game's, and would fail the whole upload.
const isId = (value: string) => /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2_147_483_647;

/** The sighting a parsed `seen` envelope holds, or null for one no game wrote. */
export function sightingFrom(envelope: Envelope<"seen">): Sighting | null {
  const npc = /^(creature|gameobject):(\d+)$/.exec(envelope.fields.npc ?? "");
  const zones = (envelope.fields.zones ?? "").split(",").filter(Boolean);
  if (!npc || !isId(npc[2]) || zones.length === 0 || zones.length > MAX_ZONES || !zones.every(isId)) return null;
  return { npcType: npc[1] as Sighting["npcType"], npcId: Number(npc[2]), zones: [...new Set(zones.map(Number))] };
}
