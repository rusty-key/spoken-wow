import { describe, expect, it, vi } from "vitest";

import { observedFrom } from "./resolve";

describe("observedFrom", () => {
  it("reads what the addon reported", () => {
    expect(
      observedFrom({
        npc: "205729 Boarton Shadetotem",
        kind: "creature",
        model: "122055",
        sex: "2",
        creature: "Humanoid",
        build: "1.60.1/69913",
      }),
    ).toEqual({
      npcKind: "creature",
      npcId: 205729,
      npcName: "Boarton Shadetotem",
      modelFileId: 122055,
      displayIds: [],
      sex: 2,
      creatureType: "Humanoid",
      build: "1.60.1/69913",
    });
  });

  // An older addon sends none of it -- no `kind` either, and a gameobject quest-giver is
  // reachable through this same kind-less envelope, so guessing "creature" is not safe.
  it("reads an envelope with no observations at all", () => {
    expect(observedFrom({ npc: "205729 Boarton Shadetotem" })).toEqual({
      npcKind: null,
      npcId: 205729,
      npcName: "Boarton Shadetotem",
      modelFileId: null,
      displayIds: [],
      sex: null,
      creatureType: null,
      build: null,
    });
  });

  it("refuses a model id that is not digits, rather than guessing", () => {
    expect(observedFrom({ npc: "1 X", model: "12a055" }).modelFileId).toBe(null);
  });

  it("has no npc at all for a gossip envelope missing one", () => {
    expect(observedFrom({}).npcId).toBe(null);
  });

  // checkEnvelope only requires a digit run ending at a space, with no magnitude bound, so
  // npc=99999999999 Foo + kind=creature is a contribution checkEnvelope accepts. npcId,
  // modelFileId and sex are all `integer` columns (migration 0030) with the same exposure --
  // past 2147483647, an insert of any one of them 500s. Refused here rather than left to
  // Postgres to reject: getResolution/upsertResolution are never reached at all with a null
  // npcId (resolveNpc bails before either), so no npc_resolution row is ever attempted for an
  // id this large, and neither the triage page nor the export ever asks the database about it.
  it("refuses an npc id past Postgres's integer range, rather than store a poisoned row", () => {
    const observed = observedFrom({ npc: "99999999999 Foo", kind: "creature" });
    expect(observed.npcId).toBe(null);
    // npcKind still resolves -- only the id itself is out of range -- so a caller has to check
    // npcId specifically, which resolveNpc already does (`npcId === null`, not falsy).
    expect(observed.npcKind).toBe("creature");
  });

  it("accepts an npc id at exactly Postgres's integer ceiling", () => {
    expect(observedFrom({ npc: "2147483647 Foo", kind: "creature" }).npcId).toBe(2147483647);
  });

  it("refuses an out-of-range model file id the same way", () => {
    expect(observedFrom({ npc: "1 X", model: "99999999999" }).modelFileId).toBe(null);
  });

  it("refuses an out-of-range sex the same way", () => {
    expect(observedFrom({ npc: "1 X", sex: "99999999999" }).sex).toBe(null);
  });

  it("reads the appearance ids the addon rolled", () => {
    expect(observedFrom({ npc: "3084 Bluffwatcher", displays: "2141,9391,9392" }).displayIds).toEqual([
      2141, 9391, 9392,
    ]);
  });

  // The envelope is unauthenticated text: one bad entry drops that entry, not the rest.
  it("keeps the well-formed ids of a damaged list, once each", () => {
    expect(observedFrom({ npc: "1 X", displays: "2141,,x9,2141,99999999999, 9392" }).displayIds).toEqual([
      2141, 9392,
    ]);
  });

  it("stops at sixteen ids, since a creature has at most four appearances", () => {
    const many = Array.from({ length: 40 }, (_, i) => i + 1).join(",");
    expect(observedFrom({ npc: "1 X", displays: many }).displayIds).toHaveLength(16);
  });
});

vi.mock("@/lib/quests/catalogue", () => ({
  defaultFlavorFor: vi.fn(),
}));
vi.mock("./display-voices", () => ({ voiceFromDisplays: vi.fn() }));
vi.mock("./store", () => ({
  NPC_ROW_KINDS: ["creature", "gameobject", "item"],
  getResolution: vi.fn(),
  upsertResolution: vi.fn(async (row) => ({ ...row, updatedAt: "now" })),
  getBodies: vi.fn(async () => []),
  upsertBody: vi.fn(async (row) => ({ ...row, gender: row.sex === 2 ? "male" : "female", updatedAt: "now" })),
}));

import { defaultFlavorFor } from "@/lib/quests/catalogue";

import { voiceFromDisplays } from "./display-voices";
import { getResolution, getBodies, upsertBody, upsertResolution } from "./store";
import { resolveNpc } from "./resolve";
import { splitByBody } from "./split";

const observed = {
  npcKind: "creature" as const,
  npcId: 205729,
  npcName: "Boarton Shadetotem",
  modelFileId: 122055,
  displayIds: [] as number[],
  sex: 2,
  creatureType: "Humanoid",
  build: "1.60.1/69913",
};

describe("resolveNpc", () => {
  it("prefers a moderator's answer over everything", async () => {
    vi.mocked(getResolution).mockResolvedValue({
      ...observed, race: "highmountaintauren", gender: "male", flavor: "grim",
      provenance: "moderator", confirmed: true, doubtful: false, note: null, resolvedBy: "u1", updatedAt: "now",
    });
    const row = await resolveNpc(observed, "enUS");
    expect(row?.race).toBe("highmountaintauren");
    expect(upsertResolution).not.toHaveBeenCalled();
  });

  it("takes the corpus's answer, flavor and all, for an npc it already carries", async () => {
    vi.mocked(getResolution).mockResolvedValue({
      ...observed, race: "tauren", gender: "male", flavor: "grim",
      provenance: "corpus", confirmed: true, doubtful: false, note: null, resolvedBy: null, updatedAt: "now",
    });
    const row = await resolveNpc(observed, "enUS");
    expect(row).toMatchObject({ race: "tauren", flavor: "grim", provenance: "corpus", confirmed: true });
  });

  it("falls back to the model the client reported, with a corpus-derived defaulted flavor", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    // tauren-male has no "standard" voice at all (the branch's own flagship case, model
    // 122055) -- defaultFlavorFor is what decides that, not a constant, so this only proves
    // resolveNpc plumbs its answer through rather than proving the answer itself; corpus.test.ts
    // pins defaultFlavorFor's own behaviour against the real corpus.
    vi.mocked(defaultFlavorFor).mockResolvedValue("warrior");
    const row = await resolveNpc(observed, "enUS");
    expect(row).toMatchObject({
      race: "tauren", gender: "male", flavor: "warrior", provenance: "client", confirmed: false,
    });
    expect(defaultFlavorFor).toHaveBeenCalledWith("tauren", "male");
  });

  it("names the npc in the language of the client that saw it", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockResolvedValue("warrior");
    await resolveNpc(observed, "deDE");
    expect(upsertResolution).toHaveBeenLastCalledWith(
      expect.objectContaining({ npcName: "Boarton Shadetotem", nameLang: "deDE" }),
    );
  });

  it("leaves the flavor null when the race-gender has no default to fall back on", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockResolvedValue(null);
    const row = await resolveNpc(observed, "enUS");
    expect(row).toMatchObject({ flavor: null, provenance: "client", confirmed: false });
  });

  it("resolves to no race for a creature model that is not a character", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockClear();
    const row = await resolveNpc({ ...observed, modelFileId: 1 }, "enUS");
    expect(row).toMatchObject({ race: null, provenance: "none", confirmed: false });
    // No race-gender to look a default up for -- raceForModel(1) answers null, so there is
    // nothing for defaultFlavorFor to be asked about at all.
    expect(defaultFlavorFor).not.toHaveBeenCalled();
  });

  it("types a critter with no character body as a generic creature, in the client's language", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    for (const creatureType of ["Critter", "Kleintier", "Tier", "Bestia"]) {
      const row = await resolveNpc({ ...observed, modelFileId: 1, creatureType }, "enUS");
      expect(row).toMatchObject({ race: "creature", gender: null, flavor: null, provenance: "client", confirmed: false });
    }
  });

  it("leaves an elemental with no character body for a moderator", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    const row = await resolveNpc({ ...observed, modelFileId: 1, creatureType: "Elemental" }, "enUS");
    expect(row).toMatchObject({ race: null, provenance: "none" });
  });

  it("takes the body's race over a beast's type", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    const row = await resolveNpc({ ...observed, creatureType: "Beast" }, "enUS");
    expect(row?.race).toBe("tauren");
  });

  it("does nothing at all for an envelope with no npc", async () => {
    expect(await resolveNpc({ ...observed, npcId: null }, "enUS")).toBe(null);
  });

  it("does not mistake npc id 0 for no npc at all", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    const row = await resolveNpc({ ...observed, npcId: 0 }, "enUS");
    expect(row).not.toBe(null);
    expect(getResolution).toHaveBeenCalledWith(observed.npcKind, 0);
  });

  // A kind-less envelope can be a gameobject wearing the old creature-shaped envelope, so
  // resolving it (or writing a row for it) would risk merging the two id spaces.
  it("does nothing for a kind-less envelope, and touches neither the store nor the contribution", async () => {
    vi.mocked(getResolution).mockClear();
    vi.mocked(upsertResolution).mockClear();
    expect(await resolveNpc({ ...observed, npcKind: null }, "enUS")).toBe(null);
    expect(getResolution).not.toHaveBeenCalled();
    expect(upsertResolution).not.toHaveBeenCalled();
  });
  it("takes the game's voice for the appearance the player saw, confirmed", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockResolvedValue({
      exact: true, voice: { race: "tauren", gender: "female", flavor: "official" },
    });
    const row = await resolveNpc({ ...observed, displayIds: [2141, 9392] }, "enUS");
    expect(voiceFromDisplays).toHaveBeenCalledWith([2141, 9392], 122055);
    expect(row).toMatchObject({
      race: "tauren", gender: "female", flavor: "official", provenance: "display", confirmed: true,
    });
  });

  it("picks the default flavor when it is one the appearances offer", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockResolvedValue({
      exact: false, race: "dwarf", gender: "female", flavors: ["guard", "maternal", "young"],
    });
    vi.mocked(defaultFlavorFor).mockResolvedValue("maternal");
    const row = await resolveNpc({ ...observed, displayIds: [36630, 144322, 146689] }, "enUS");
    expect(row).toMatchObject({
      race: "dwarf", gender: "female", flavor: "maternal", provenance: "client", confirmed: false,
    });
  });

  it("picks among the offered flavors when the default is not one of them", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockResolvedValue({
      exact: false, race: "dwarf", gender: "female", flavors: ["guard", "young"],
    });
    vi.mocked(defaultFlavorFor).mockResolvedValue("maternal");
    const row = await resolveNpc({ ...observed, displayIds: [144322, 146689] }, "enUS");
    expect(row).toMatchObject({ flavor: "guard", provenance: "client", confirmed: false });
  });

  it("falls back to the model when the appearances say nothing", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockResolvedValue("warrior");
    const row = await resolveNpc({ ...observed, displayIds: [999_999] }, "enUS");
    expect(row).toMatchObject({ race: "tauren", gender: "male", flavor: "warrior", provenance: "client" });
  });

  it("does not look appearances up when the envelope carried none", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockClear();
    await resolveNpc(observed, "enUS");
    expect(voiceFromDisplays).not.toHaveBeenCalled();
  });
  // The envelope is unauthenticated: appearances alone must not be able to plant a confirmed
  // voice. Without a model the server knows, they narrow a guess and nothing more.
  it("does not confirm a voice from appearances without a model it knows", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockResolvedValue({
      exact: true, voice: { race: "tauren", gender: "female", flavor: "official" },
    });
    vi.mocked(defaultFlavorFor).mockResolvedValue("standard");
    const row = await resolveNpc({ ...observed, modelFileId: null, displayIds: [9392] }, "enUS");
    expect(row).toMatchObject({
      race: "tauren", gender: "female", flavor: "official", provenance: "client", confirmed: false,
    });
  });

  // Gameobject ids are their own id space; SetCreature would describe whichever creature shares
  // the number, so a gameobject's appearances mean nothing even if an envelope carries them.
  it("never looks appearances up for a gameobject", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockClear();
    await resolveNpc({ ...observed, npcKind: "gameobject", displayIds: [9392] }, "enUS");
    expect(voiceFromDisplays).not.toHaveBeenCalled();
  });

  it("types a gameobject the corpus does not carry as a gameobject, unconfirmed", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    const row = await resolveNpc({ ...observed, npcKind: "gameobject", npcId: 424005, npcName: "Pocket Litter" }, "enUS");
    expect(row).toMatchObject({
      race: "gameobject", gender: null, flavor: null, provenance: "client", confirmed: false,
    });
  });

  it("types an item the corpus does not carry as an item, unconfirmed", async () => {
    vi.mocked(getResolution).mockResolvedValue(null);
    vi.mocked(voiceFromDisplays).mockClear();
    const row = await resolveNpc({ ...observed, npcKind: "item", npcId: 247857, npcName: "Nibbled-On Book" }, "enUS");
    expect(row).toMatchObject({
      npcKind: "item", race: "item", gender: null, flavor: null, provenance: "client", confirmed: false,
    });
    expect(voiceFromDisplays).not.toHaveBeenCalled();
  });

  it("keeps the corpus's gameobject, which has no gender", async () => {
    vi.mocked(getResolution).mockResolvedValue({
      ...observed, npcKind: "gameobject", race: "gameobject", gender: null, flavor: null,
      provenance: "corpus", confirmed: true, doubtful: false, note: null, resolvedBy: null, updatedAt: "now",
    });
    const row = await resolveNpc({ ...observed, npcKind: "gameobject" }, "enUS");
    expect(row).toMatchObject({ race: "gameobject", provenance: "corpus", confirmed: true });
  });
});

describe("splitting by body", () => {
  const corpusGuard = {
    npcKind: "creature" as const, npcId: 68, npcName: null, race: "human", gender: "male", flavor: "official",
    provenance: "corpus" as const, confirmed: true, doubtful: false, modelFileId: null, sex: null,
    creatureType: null, build: null, note: null, resolvedBy: null, updatedAt: "then",
  };
  // humanfemale.m2 in character-models.json.
  const woman = { ...observed, npcId: 68, sex: 3, modelFileId: 119563 };

  it("splits an NPC voiced as a man and seen as a woman, the man keeping the NPC's answer", async () => {
    vi.mocked(getResolution).mockResolvedValue(corpusGuard);
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertBody).mockClear();
    vi.mocked(voiceFromDisplays).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockResolvedValue("standard");
    await resolveNpc(woman, "enUS");
    expect(vi.mocked(upsertBody).mock.calls.map(([row]) => [row.sex, row.race, row.flavor, row.provenance])).toEqual([
      [2, "human", "official", "corpus"],
      [3, "human", "standard", "client"],
    ]);
  });

  it("takes the game's voice for the woman's appearance where it is exact", async () => {
    vi.mocked(getResolution).mockResolvedValue(corpusGuard);
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertBody).mockClear();
    vi.mocked(voiceFromDisplays).mockResolvedValue({ exact: true, voice: { race: "human", gender: "female", flavor: "official" } });
    await resolveNpc({ ...woman, displayIds: [3167, 5446] }, "enUS");
    expect(vi.mocked(upsertBody).mock.calls[1][0]).toMatchObject({ sex: 3, flavor: "official", provenance: "display", confirmed: true });
  });

  it("leaves an NPC seen as the body it is voiced as alone", async () => {
    vi.mocked(getResolution).mockResolvedValue(corpusGuard);
    vi.mocked(getBodies).mockClear();
    vi.mocked(upsertBody).mockClear();
    await resolveNpc({ ...woman, sex: 2 }, "enUS");
    expect(upsertBody).not.toHaveBeenCalled();
  });

  // Answered first, a client's guess would be retyped as the sex just seen -- the write ranks
  // as high as the guess -- and the NPC would flip rather than split.
  it("splits an NPC only a client's guess knows, rather than retyping it as the sex seen", async () => {
    vi.mocked(getResolution).mockResolvedValue({ ...corpusGuard, provenance: "client", confirmed: false });
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertResolution).mockClear();
    vi.mocked(upsertBody).mockClear();
    vi.mocked(voiceFromDisplays).mockResolvedValue(null);
    vi.mocked(defaultFlavorFor).mockResolvedValue("standard");
    const row = await resolveNpc(woman, "enUS");
    expect(row).toMatchObject({ gender: "male", provenance: "client" });
    expect(upsertResolution).not.toHaveBeenCalled();
    expect(vi.mocked(upsertBody).mock.calls.map(([sex]) => [sex.sex, sex.provenance])).toEqual([
      [2, "client"],
      [3, "client"],
    ]);
  });

  it("answers only the sex it lacks for an NPC split already", async () => {
    vi.mocked(getResolution).mockResolvedValue(corpusGuard);
    const man = { ...corpusGuard, sex: 2 as const, gender: "male" as const, race: "human", weight: null, provenance: "corpus" as const };
    vi.mocked(getBodies).mockResolvedValueOnce([man]);
    vi.mocked(upsertBody).mockClear();
    vi.mocked(voiceFromDisplays).mockResolvedValue(null);
    await resolveNpc(woman, "enUS");
    expect(vi.mocked(upsertBody).mock.calls.map(([row]) => row.sex)).toEqual([3]);
  });

  const npcDwarf = { ...corpusGuard, npcId: 15906, race: "dwarf", gender: "male", flavor: "standard" };
  const gnomeMan = { ...observed, npcId: 15906, sex: 2, modelFileId: 119159 };

  it("splits an NPC drawn as another race of its own sex", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody(gnomeMan, npcDwarf)).toBe(true);
    expect(vi.mocked(upsertBody).mock.calls.map(([row]) => [row.race, row.sex])).toEqual([
      ["dwarf", 2],
      ["gnome", 2],
    ]);
  });

  it("does not split on a model it cannot read, when the sex matches", async () => {
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody({ ...gnomeMan, modelFileId: 1 }, npcDwarf)).toBe(false);
    expect(upsertBody).not.toHaveBeenCalled();
  });

  it("answers a body seen on an NPC split already, once", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([
      { npcKind: "creature", npcId: 15906, race: "dwarf", sex: 2, gender: "male" } as never,
      { npcKind: "creature", npcId: 15906, race: "gnome", sex: 2, gender: "male" } as never,
    ]);
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody(gnomeMan, npcDwarf)).toBe(true);
    expect(upsertBody).not.toHaveBeenCalled();
  });

  it("splits an NPC whose one body row is the body seen, one row being no split", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([
      { npcKind: "creature", npcId: 15906, race: "gnome", sex: 2, gender: "male" } as never,
    ]);
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody(gnomeMan, npcDwarf)).toBe(true);
    expect(vi.mocked(upsertBody).mock.calls.map(([row]) => [row.race, row.sex])).toEqual([
      ["dwarf", 2],
      ["gnome", 2],
    ]);
  });

  it("leaves an NPC whose one body row is its own body unsplit, seen as that body", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([
      { npcKind: "creature", npcId: 15906, race: "dwarf", sex: 2, gender: "male" } as never,
    ]);
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody({ ...gnomeMan, modelFileId: 118355 }, npcDwarf)).toBe(false);
    expect(upsertBody).not.toHaveBeenCalled();
  });

  it("stores a race the roster has no voice for as a guess, unconfirmed", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertBody).mockClear();
    // 1793470 is a thinhuman man's model: a race in the model map that no voice reads.
    await splitByBody({ ...gnomeMan, modelFileId: 1793470 }, { ...npcDwarf, race: "human" });
    const seen = vi.mocked(upsertBody).mock.calls.at(-1)![0];
    expect(seen).toMatchObject({ race: "thinhuman", sex: 2, provenance: "client", confirmed: false });
  });

  it("answers its own body on an NPC split without it", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([
      { npcKind: "creature", npcId: 15906, race: "gnome", sex: 2, gender: "male" } as never,
      { npcKind: "creature", npcId: 15906, race: "gnome", sex: 3, gender: "female" } as never,
    ]);
    vi.mocked(upsertBody).mockClear();
    expect(await splitByBody({ ...gnomeMan, modelFileId: 118355 }, npcDwarf)).toBe(true);
    expect(vi.mocked(upsertBody).mock.calls.map(([row]) => [row.race, row.sex])).toEqual([["dwarf", 2]]);
  });

  it("takes no flavor from displays of another race than the body seen", async () => {
    vi.mocked(getBodies).mockResolvedValueOnce([]);
    vi.mocked(upsertBody).mockClear();
    vi.mocked(defaultFlavorFor).mockResolvedValue("standard");
    vi.mocked(voiceFromDisplays).mockResolvedValue({ exact: false, race: "gnome", gender: "female", flavors: ["gnomish"] });
    // An unreadable model: the body seen keeps the NPC's dwarf race, whatever the displays say.
    await splitByBody({ ...gnomeMan, sex: 3, modelFileId: 1, displayIds: [1] }, npcDwarf);
    expect(vi.mocked(upsertBody).mock.calls.at(-1)![0]).toMatchObject({ race: "dwarf", sex: 3, flavor: "standard" });
  });
});
