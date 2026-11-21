/**
 * Splitting an NPC by body when a player sees it drawn as a body its voice is not: another sex,
 * or another race (an Ironforge Reveler drawn as a gnome). The extract splits the NPCs the world
 * database knows; a contribution splits the rest. The NPC's own answer becomes its own body's,
 * and the body seen is answered from the client's report.
 */
import { defaultFlavorFor } from "@/lib/quests/catalogue";

import { voiceFromDisplays } from "./display-voices";
import { raceOfModel } from "./models";
import type { Observed } from "./resolve";
import { isSex, SEX_GENDER, sexOf, type Sex } from "./npc";
import { getBodies, upsertBody, type NpcBodyAnswer, type NpcResolution } from "./store";

export type BodyInput = Omit<NpcBodyAnswer, "gender" | "updatedAt">;

/** The race a player saw: the model's where the map knows it, else the NPC's own. */
function seenRace(observed: Observed, sex: Sex, race: string): string {
  return raceOfModel(observed.modelFileId, SEX_GENDER[sex]) ?? race;
}

/** The body the player saw, answered from what the client reported. */
async function answerFor(observed: Observed, sex: Sex, race: string): Promise<BodyInput> {
  const gender = SEX_GENDER[sex];
  const displays = observed.displayIds.length
    ? await voiceFromDisplays(observed.displayIds, observed.modelFileId)
    : null;
  const exact = displays?.exact && displays.voice.gender === gender && displays.voice.race === race
    ? displays.voice : null;
  const offered = displays && !displays.exact && displays.gender === gender && displays.race === race ? displays.flavors : [];
  const fallback = exact ? null : await defaultFlavorFor(race, gender);
  return {
    npcKind: "creature",
    npcId: observed.npcId as number,
    race,
    sex,
    weight: null,
    flavor: exact ? exact.flavor : offered.length && !offered.includes(fallback ?? "") ? offered[0] : fallback,
    provenance: exact ? "display" : "client",
    confirmed: Boolean(exact),
    doubtful: false,
    note: null,
    resolvedBy: null,
  };
}

/**
 * Split `npc` into its own body and `other`: its own answer, as `own` restamps it, for the body
 * it is -- unless that body is answered already. Every split goes through here, so a split NPC
 * always has its own body's row.
 */
export async function splitNpc(
  npc: NpcResolution,
  other: BodyInput,
  own: Partial<BodyInput> = {},
  bodies?: NpcBodyAnswer[],
): Promise<void> {
  const sex = sexOf(npc.gender);
  if (sex === null || !npc.race || (other.sex === sex && other.race === npc.race)) {
    throw new Error(`splitNpc: ${npc.npcKind}/${npc.npcId} is not another body`);
  }
  const race = npc.race;
  if (!(bodies ?? (await getBodies(npc.npcKind, npc.npcId))).some((row) => row.sex === sex && row.race === race)) {
    await upsertBody({
      npcKind: npc.npcKind,
      npcId: npc.npcId,
      race,
      sex,
      weight: null,
      flavor: npc.flavor,
      provenance: npc.provenance === "none" ? "client" : npc.provenance,
      confirmed: npc.confirmed,
      doubtful: npc.doubtful,
      note: null,
      resolvedBy: npc.resolvedBy,
      ...own,
    });
  }
  await upsertBody(other);
}

/**
 * Split `npc` if the player saw it drawn as a body its voice is not, or answer the body seen on
 * an NPC split already. Returns whether the NPC is split; false where the player saw the body it
 * is voiced as, or a model the map cannot name with the sex it is voiced as.
 */
export async function splitByBody(observed: Observed, npc: NpcResolution | null): Promise<boolean> {
  const sex = observed.sex;
  if (observed.npcKind !== "creature" || observed.npcId === null || !isSex(sex) || !npc?.race) return false;
  const own = sexOf(npc.gender);
  if (own === null || npc.provenance === "none") return false;
  const race = seenRace(observed, sex, npc.race);
  const bodies = await getBodies("creature", observed.npcId);
  // A split is two or more rows: a row alone (a moderator's body an import kept) splits nothing.
  if (bodies.length >= 2 && bodies.some((row) => row.sex === sex && row.race === race)) return true;
  if (sex === own && race === npc.race) {
    // Its own body: nothing to split, or, beside another body's row, that body answered.
    if (!bodies.some((row) => row.sex !== sex || row.race !== race)) return false;
    await upsertBody(await answerFor(observed, sex, race));
    return true;
  }
  await splitNpc(npc, await answerFor(observed, sex, race), {}, bodies);
  return true;
}
