/**
 * An NPC's voice answer in the shape the speaker controls render, built without the corpus.
 *
 * Node-free, like query.ts: SpeakerCell and ContributionTable are client components and call
 * these on every save, and /npcs calls them on the server for every NPC on file, as triage.ts's
 * npcSummaryFrom does with the roster store's Roster.
 */
import type { NpcResolution, NpcBodyAnswer } from "../npc/store";
import type { Roster } from "../voices/roster";
import type { NpcSummary } from "./triage";

/** The flavors a type (and its gender, where it has genders) is voiced in, or [] while unknown. */
export function flavorOptionsFor(race: string | null, gender: string | null, roster: Roster): string[] {
  if (!race || (!gender && !roster.isGenderless(race))) return [];
  return roster.flavorsOf(race, gender);
}

/** Why an NPC of this type cannot speak yet: a speaker is written with its voice. */
export function noVoice(type: { race: string | null; gender: string | null; flavor: string | null }): string {
  return `No voice reads ${[type.race, type.gender, type.flavor].filter(Boolean).join("-")} yet`;
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

/** One body of a split NPC, as SpeakerCell renders it: the NPC, drawn as that race and sex. */
export function summaryFromBody(npc: NpcSummary, answer: NpcBodyAnswer, roster: Roster): NpcSummary {
  return {
    ...npc,
    race: answer.race,
    gender: answer.gender,
    flavor: answer.flavor,
    provenance: answer.provenance,
    confirmed: answer.confirmed,
    doubtful: answer.doubtful,
    flavorOptions: flavorOptionsFor(answer.race, answer.gender, roster),
  };
}
