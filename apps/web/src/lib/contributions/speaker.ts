/**
 * An NPC's voice answer in the shape the speaker controls render, built without the corpus.
 *
 * Node-free, like query.ts: SpeakerCell and ContributionTable are client components and call
 * these on every save, and /npcs calls them on the server for every NPC on file, as triage.ts's
 * npcSummaryFrom does with the roster store's Roster.
 */
import type { NpcResolution } from "../npc/store";
import type { Roster } from "../voices/roster";
import type { NpcSummary } from "./triage";

/** The flavors a type (and its gender, where it has genders) is voiced in, or [] while unknown. */
export function flavorOptionsFor(race: string | null, gender: string | null, roster: Roster): string[] {
  if (!race || (!gender && !roster.isGenderless(race))) return [];
  return roster.flavorsOf(race, gender);
}

/** A stored resolution, as SpeakerCell renders it. */
export function summaryFromResolution(resolution: NpcResolution, roster: Roster): NpcSummary {
  return {
    npcKind: resolution.npcKind,
    npcId: resolution.npcId,
    npcName: resolution.npcName,
    race: resolution.race,
    gender: resolution.gender,
    flavor: resolution.flavor,
    provenance: resolution.provenance,
    confirmed: resolution.confirmed,
    doubtful: resolution.doubtful,
    flavorOptions: flavorOptionsFor(resolution.race, resolution.gender, roster),
    conflict: [],
  };
}
