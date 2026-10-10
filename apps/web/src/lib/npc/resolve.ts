/**
 * Who is speaking a contributed line.
 *
 * Four sources, in this order, and the order is the whole design:
 *
 *   1. A moderator's answer, if one exists. They may know something no data source does.
 *   2. The corpus, for an NPC it already carries. Exact, including the flavor, which is
 *      recovered from display data no client API exposes.
 *   3. The appearances the addon rolled with SetCreature, kept where they match the body the
 *      client reported, and mapped through display-voices.json. Exact when one voice is left.
 *   4. What the client saw: a model file id, which names a race and a gender. The flavor is
 *      narrowed by step 3 where it offered several, defaulted otherwise, and left unconfirmed.
 *
 * An NPC that answers to none of them resolves to no race, which is a normal outcome rather
 * than a failure: the corpus already carries `narrator-male` for things that are not a race.
 */
import type { Lang } from "@/lib/lang";
import { defaultFlavorFor } from "@/lib/quests/catalogue";

import { voiceFromDisplays } from "./display-voices";
import { raceForModel } from "./models";
import { INT32_MAX } from "./npc";
import { getResolution, NPC_KINDS, upsertResolution, type NpcKind, type NpcResolution } from "./store";

// The three integer columns npc and contribution both ultimately feed from an
// unauthenticated envelope: an id this large is still "a digit run ending at a space" as far
// as checkEnvelope is concerned, but Postgres's `integer` tops out at 2147483647, and a value
// past that 500s every reader of the row (the triage page's Promise.all, the export's
// unnest($::int[])) rather than merely failing to resolve. Bounding it here, at the one place
// both consumers get npcId/modelFileId/sex from (digits() below), means neither has to know
// this rule exists.

export type Observed = {
  npcKind: NpcKind | null;
  npcId: number | null;
  npcName: string | null;
  modelFileId: number | null;
  /** Appearance ids the addon rolled for this creature; empty when it sent none. */
  displayIds: number[];
  sex: number | null;
  creatureType: string | null;
  build: string | null;
};

const DIGITS = /^\d+$/;

// npcId, modelFileId and sex all land in an `integer` column (migration 0030), and all three
// come straight from an unauthenticated envelope: checkEnvelope only requires a digit run, with
// no magnitude bound. Past 2147483647 Postgres rejects the insert, but that only protects the
// npc row -- the contribution itself already stored, permanently, with the
// oversized value in its meta. Bounding here, before either column is ever written, is what
// keeps a single out-of-range paste from turning into a row that 500s every reader of it: the
// triage page's Promise.all (page.tsx) and the export's unnest($::int[]) (export/route.ts) both
// go through this function to get there.
function digits(value: string | undefined): number | null {
  if (!value || !DIGITS.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= INT32_MAX ? n : null;
}

// A creature has at most four appearances (Creature.DisplayID_0..3). The addon rolls a dozen
// times, so more distinct ids than this can only be a hand-edited envelope, and each one costs
// a table lookup.
const MAX_DISPLAYS = 16;

// Each entry through digits(), like every other number an envelope carries: one bad entry
// drops that entry, not the list.
function displayIdsFrom(value: string | undefined): number[] {
  const ids: number[] = [];
  for (const part of (value ?? "").split(",")) {
    const id = digits(part.trim());
    if (id !== null && id > 0 && !ids.includes(id)) ids.push(id);
    if (ids.length === MAX_DISPLAYS) break;
  }
  return ids;
}

export function observedFrom(meta: Record<string, string>): Observed {
  // `npc` is "<id> <name>" -- the id, then whatever the client called them.
  const npc = meta.npc?.match(/^(\d+)(?:\s+(.*))?$/);
  const kind = (NPC_KINDS as readonly string[]).includes(meta.kind ?? "")
    ? (meta.kind as NpcKind)
    : null;
  // Through the same bound as modelFileId and sex, not a bare Number(): the regex only proves
  // digits, not that they fit in `integer`, and npcId is the one of the three that gets used as
  // a lookup key rather than merely stored, so an unbounded value here is the one that reaches
  // getResolution/upsertResolution at all.
  const npcId = digits(npc?.[1]);

  return {
    // No default for an absent `kind`: the pre-kind envelope came from `TargetForGUID`, which
    // resolves any GUID `CanHaveID` covers, including GameObject -- gameobject quest-givers
    // are real and reachable this way. Guessing "creature" would risk filing one under the
    // creature id space, exactly the collision npcKey's namespacing exists to prevent.
    npcKind: npc ? kind : null,
    npcId,
    npcName: npc?.[2]?.trim() || null,
    modelFileId: digits(meta.model),
    displayIds: displayIdsFrom(meta.displays),
    sex: digits(meta.sex),
    creatureType: meta.creature || null,
    build: meta.build || null,
  };
}

/** `lang` is the language of the client that observed the NPC, and so of its name. */
export async function resolveNpc(observed: Observed, lang: Lang | null): Promise<NpcResolution | null> {
  const { npcKind, npcId } = observed;
  // `npcId === null`, not a truthiness check: id 0 is a real id and must not be mistaken for
  // "no npc at all". A kind-less envelope (see observedFrom) also fails here since npcKind is
  // null in that case -- an envelope old enough to lack `kind` also lacks `model`, so the best
  // row it could ever produce is `provenance: "none"` with no race, gender or flavor: a row
  // whose entire content is a name the contribution itself already carries. Not worth risking
  // a gameobject filed under a creature id. The player's next submission, after an addon
  // update, resolves properly.
  if (!npcKind || npcId === null) return null;

  const existing = await getResolution(npcKind, npcId);
  // The store's upsert already ranks provenance and would refuse a lower-ranked write on its
  // own, so this is not what keeps a moderator's answer safe -- it is here so a moderator-owned
  // NPC skips the write entirely, rather than arriving back where it started.
  if (existing?.provenance === "moderator") return existing;

  // The extract's answer is the npc table's `corpus` row (migration 0070). Only extracted NPCs
  // have one: an NPC a contribution named was answered from its own resolution at the time, and
  // reading that back as the corpus would confirm a guess. Its name is in entity_name already.
  const corpus = existing?.provenance === "corpus" && existing.race && existing.gender ? existing : null;
  if (corpus) {
    return upsertResolution({
      npcKind,
      npcId,
      npcName: null,
      race: corpus.race,
      gender: corpus.gender,
      flavor: corpus.flavor,
      provenance: "corpus",
      confirmed: true,
      doubtful: false,
      modelFileId: observed.modelFileId,
      sex: observed.sex,
      creatureType: observed.creatureType,
      build: observed.build,
      note: null,
      resolvedBy: null,
    });
  }

  // The appearances the addon rolled, filtered to the body the player saw. One voice left is
  // the game's own answer, as exact as the corpus: display-voices.json reads it from the same
  // NPCSounds data tts_cli/flavors.py reads for the corpus.
  //
  // Creatures only: a gameobject id is its own id space, and SetCreature would have described
  // whichever creature shares the number. And confirmed only with a body the server knows: the
  // envelope is unauthenticated, and appearances alone would let a hand-edited one plant a
  // confirmed voice that no player report can ever outrank.
  const fromDisplays = npcKind === "creature" && observed.displayIds.length
    ? await voiceFromDisplays(observed.displayIds, observed.modelFileId)
    : null;
  const body = raceForModel(observed.modelFileId);
  if (fromDisplays?.exact && body) {
    return upsertResolution({
      npcKind,
      npcId,
      npcName: lang ? observed.npcName : null,
      nameLang: lang ?? undefined,
      ...fromDisplays.voice,
      provenance: "display",
      confirmed: true,
      doubtful: false,
      modelFileId: observed.modelFileId,
      sex: observed.sex,
      creatureType: observed.creatureType,
      build: observed.build,
      note: null,
      resolvedBy: null,
    });
  }

  // Several voices on one body, or one voice with no body to vouch for it, still settle the
  // race and gender, and narrow the flavor to the ones this NPC can actually speak with.
  const narrowed = fromDisplays?.exact
    ? { ...fromDisplays.voice, flavors: fromDisplays.voice.flavor ? [fromDisplays.voice.flavor] : [] }
    : fromDisplays;
  const fromModel = narrowed ?? body;
  // A flavor nobody has confirmed, derived the way tts_cli/flavors.py's fallback_flavors
  // derives its own: "standard" where the race-gender has it, otherwise its busiest flavor,
  // from the corpus rather than a constant. A constant would leave four race-genders
  // (dwarf-female, goblin-female, goblin-male, tauren-male) pointing at a voice that does not
  // exist -- this branch's own flagship case, model 122055/tauren-male, used to emit
  // "tauren-male-standard", which nothing can produce. defaultFlavorFor answers null for a race
  // the corpus has never carried a flavored line for at all, and null is left alone rather than
  // guessed at: the row is unconfirmed regardless, and a moderator or the pipeline can decide.
  const fallback = fromModel ? await defaultFlavorFor(fromModel.race, fromModel.gender) : null;
  // The default wins when the appearances offer it, so a narrowed row and a model-only row
  // agree wherever they can.
  const offered = narrowed?.flavors ?? [];
  const flavor = offered.length && !offered.includes(fallback ?? "") ? offered[0] : fallback;
  return upsertResolution({
    npcKind,
    npcId,
    npcName: lang ? observed.npcName : null,
    nameLang: lang ?? undefined,
    race: fromModel?.race ?? null,
    gender: fromModel?.gender ?? null,
    flavor,
    provenance: fromModel ? "client" : "none",
    confirmed: false,
    doubtful: false,
    modelFileId: observed.modelFileId,
    sex: observed.sex,
    creatureType: observed.creatureType,
    build: observed.build,
    note: null,
    resolvedBy: null,
  });
}
