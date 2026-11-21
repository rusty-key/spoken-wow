/**
 * Where a player met an NPC, as the addon keeps it: one `seen` envelope per NPC, naming it and
 * every zone map (uiMapID) its quest or gossip window opened in (addons/Spoken_Quests/Contribute.lua,
 * SeeSpeaker). They sit in the same saved variables file as the lines and go up with them.
 *
 * Browser-safe, as envelope.ts is: the upload page counts them before anything is sent.
 */
import { parseEnvelope, type ParseError } from "./envelope";

export type Sighting = { npcType: "creature" | "gameobject"; npcId: number; zones: number[] };

/** SeeSpeaker's MAX_ZONES. More is a list nobody's game wrote. */
const MAX_ZONES = 8;
const INT4_MAX = 2_147_483_647;

export function sightingFrom(raw: string): { ok: true; value: Sighting } | { ok: false; error: ParseError | "incomplete" } {
  const parsed = parseEnvelope(raw, ["seen"]);
  if (!parsed.ok) return parsed;
  const npc = /^(creature|gameobject):([1-9]\d{0,9})$/.exec(parsed.value.fields.npc ?? "");
  const zones = (parsed.value.fields.zones ?? "").split(",").filter(Boolean);
  // npc_sighting's columns are 32-bit: a bigger id is no game's, and would fail the whole upload.
  if (!npc || Number(npc[2]) > INT4_MAX || zones.length === 0 || zones.length > MAX_ZONES || !zones.every((zone) => /^[1-9]\d{0,9}$/.test(zone) && Number(zone) <= INT4_MAX)) {
    return { ok: false, error: "incomplete" };
  }
  return {
    ok: true,
    value: { npcType: npc[1] as Sighting["npcType"], npcId: Number(npc[2]), zones: [...new Set(zones.map(Number))] },
  };
}

/** Whether an envelope is a sighting rather than a line, read from its header alone. */
export function isSightingEnvelope(raw: string): boolean {
  return /^\s*!SPOKEN\d+ seen\s*\n/.test(raw);
}
