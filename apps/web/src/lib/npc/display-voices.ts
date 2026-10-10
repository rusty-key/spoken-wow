/**
 * Which voice an NPC appearance speaks with.
 *
 * The appearance ids come from a client's creature cache (creature-cache.ts). What they mean
 * is in display-voices.json: per appearance, its model file, its NPCSounds voice set, and that
 * set's name where one is known.
 *
 * The voice set decides, not the model, because it is what the player hears: Elatrell
 * Featherlight is drawn as a blood elf but greets you in the Skybourne male voice, and his lines
 * should too. In order:
 *
 *   1. A named set on the roster (`tauren-male-warrior`). Exact.
 *   2. A set the roster names by its id, as it does the Skybourne ones (`skybourneelf-male-3776`).
 *      Exact.
 *   3. The model's race and gender (models.ts), with that race-gender's default flavor, or its
 *      bare voice if it has no flavors. A guess about the flavor, so it says so.
 *
 * Anything else -- a creature model, or a race the roster does not have -- has no voice, and
 * the reason says which.
 */
import "server-only";

import { defaultFlavorFor } from "@/lib/quests/catalogue";
import { loadRoster } from "@/lib/voices/roster-store";
import type { Gender } from "@/lib/voices/voices";

import table from "./display-voices.json";
import { raceForModel } from "./models";

type Entry = [modelFileId: number, npcSoundsId: number, setVoice: string | null];

const BY_DISPLAY = table as unknown as Record<string, Entry>;

export type DisplayVoice =
  | { voice: { race: string; gender: Gender; flavor: string | null }; exact: boolean; reason: string }
  | { voice: null; exact: false; reason: string };

export async function voiceForDisplay(displayId: number): Promise<DisplayVoice> {
  const entry = BY_DISPLAY[String(displayId)];
  if (!entry) {
    return { voice: null, exact: false, reason: `appearance ${displayId} has no model or voice set on file` };
  }
  const [modelFileId, npcSoundsId, setVoice] = entry;
  const roster = await loadRoster();

  if (setVoice && roster.isVoice(setVoice)) {
    const [race, gender, flavor] = setVoice.split("-");
    return { voice: { race, gender: gender as Gender, flavor }, exact: true, reason: `voice set ${setVoice}` };
  }

  const byId = npcSoundsId ? roster.data.flavors.find((f) => f.flavor === String(npcSoundsId) && f.gender) : undefined;
  if (byId) {
    const voice = { race: byId.race, gender: byId.gender as Gender, flavor: byId.flavor };
    return { voice, exact: true, reason: `voice set ${npcSoundsId}` };
  }

  const model = raceForModel(modelFileId);
  if (!model) {
    return { voice: null, exact: false, reason: setVoice ? `${setVoice} is not on the roster` : "not a character model" };
  }
  const { race, gender } = model;
  const bare = `${race}-${gender}`;
  const unmatched = setVoice ? `, ${setVoice} is not on the roster` : "";
  if (roster.isVoice(bare)) {
    return { voice: { race, gender, flavor: null }, exact: !setVoice, reason: `${bare} model${unmatched}` };
  }
  if (roster.flavorsOf(race, gender).length) {
    const flavor = await defaultFlavorFor(race, gender);
    return { voice: { race, gender, flavor }, exact: false, reason: `${bare} model, default flavor${unmatched}` };
  }
  return { voice: null, exact: false, reason: `${bare} is not on the roster` };
}

/** The model file an appearance is drawn with, or null for one not on file. */
export function modelForDisplay(displayId: number): number | null {
  return BY_DISPLAY[String(displayId)]?.[0] ?? null;
}

export type DisplaysVoice =
  | { exact: true; voice: { race: string; gender: Gender; flavor: string | null } }
  | { exact: false; race: string; gender: Gender; flavors: string[] };

/**
 * The voice behind a creature's appearances, as the addon rolled them.
 *
 * SetCreature picks one of a creature's appearances at random per call, so the addon learns
 * which appearances exist, not which one the player is looking at. The model it reports for
 * the unit on screen says which body that is, so only appearances drawn with that body stay.
 * Bodies are compared through each appearance's own model, never through the voice: Elatrell
 * Featherlight's blood elf body speaks with a Skybourne voice, and comparing voices would throw
 * away the one exact answer.
 *
 * One voice left, and every appearance exact about it: the answer. Several voices on one body
 * (a dwarf woman with the maternal, young and guard sets): the voices on offer, for the caller
 * to pick between. Bodies still mixed, because no model was reported: nothing, since picking
 * one would be a coin toss with the NPC's gender.
 */
export async function voiceFromDisplays(
  displayIds: number[],
  modelFileId: number | null,
): Promise<DisplaysVoice | null> {
  const body = raceForModel(modelFileId);
  const sameBody = (displayId: number) => {
    if (!body) return true;
    const drawn = raceForModel(modelForDisplay(displayId));
    return !drawn || (drawn.race === body.race && drawn.gender === body.gender);
  };
  const answers = await Promise.all(displayIds.filter(sameBody).map(voiceForDisplay));
  const voiced = answers.flatMap((answer) => (answer.voice ? [{ ...answer.voice, exact: answer.exact }] : []));
  if (!voiced.length) return null;

  const names = new Set(voiced.map((v) => `${v.race}-${v.gender}-${v.flavor ?? ""}`));
  if (names.size === 1 && voiced.every((v) => v.exact)) {
    const { race, gender, flavor } = voiced[0];
    return { exact: true, voice: { race, gender, flavor } };
  }
  if (new Set(voiced.map((v) => `${v.race}-${v.gender}`)).size !== 1) return null;
  const { race, gender } = voiced[0];
  const flavors = [...new Set(voiced.flatMap((v) => (v.flavor ? [v.flavor] : [])))].sort();
  return { exact: false, race, gender, flavors };
}
