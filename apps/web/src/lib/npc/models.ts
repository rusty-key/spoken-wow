/**
 * What race and gender a model file belongs to.
 *
 * The addon sends the raw file id its client reported and nothing else, so this table lives
 * here rather than in Lua: a race added upstream, or an id that turns out to mean something
 * else, is corrected in one deploy instead of waiting for every player to take an addon
 * update -- and the legacy-client players install zips by hand, so some of them never would.
 *
 * Only character models are in it. An NPC drawn with a creature model -- a murloc, a dragon,
 * an elemental -- resolves to nothing, which is the honest answer: the corpus already carries
 * `narrator-male` as a pseudo-race for things that do not have one.
 */
import models from "./character-models.json";

export type ModelRace = { race: string; gender: "male" | "female" };

const BY_FILE_ID = models as Record<string, ModelRace>;

export function raceForModel(fileId: number | null | undefined): ModelRace | null {
  if (typeof fileId !== "number" || !Number.isInteger(fileId) || fileId <= 0) return null;
  return BY_FILE_ID[String(fileId)] ?? null;
}

/**
 * The race a model draws a creature of `gender` as: null where the map does not know the model,
 * or knows it as the other gender (the report's sex wins over a model it disagrees with).
 */
export function raceOfModel(fileId: number | null | undefined, gender: "male" | "female"): string | null {
  const model = raceForModel(fileId);
  return model && model.gender === gender ? model.race : null;
}
