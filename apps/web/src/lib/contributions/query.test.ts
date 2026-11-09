import { describe, expect, it } from "vitest";

import { Roster } from "../voices/roster";
import { DEFAULT_SORT, bucketOf, contributionsHref, nextSort, sortOf, matchesSearch, matchesStage, nextContributionFilters, pageOf, stagesOf } from "./query";

describe("nextContributionFilters", () => {
  const current = { status: "new", bucket: "ready", client: "all", source: "quests", stage: [], sort: DEFAULT_SORT } as const;

  it("changes the dimension named in `next` and keeps the other", () => {
    expect(nextContributionFilters(current, { bucket: "blocked" })).toEqual({
      status: "new",
      bucket: "blocked",
      client: "all",
      source: "quests",
      stage: [],
      sort: DEFAULT_SORT,
    });
  });

  it("resets a dimension to its default when `next` names it with no value", () => {
    // FilterChip's reset button calls onChange(undefined) -- the key is present, the value
    // isn't, and that must read as "clear this filter", not "leave it alone".
    expect(nextContributionFilters({ status: "accepted", bucket: "blocked", client: "forever", source: "readables", stage: [], sort: DEFAULT_SORT }, { bucket: undefined })).toEqual(
      { status: "accepted", bucket: "ready", client: "forever", source: "readables", stage: [], sort: DEFAULT_SORT },
    );
  });

  it("changes the client dimension alone", () => {
    expect(nextContributionFilters(current, { client: "legacy" })).toEqual({ ...current, client: "legacy" });
  });

  it("leaves every dimension alone when `next` names none", () => {
    expect(nextContributionFilters(current, {})).toEqual(current);
  });
});

describe("contributionsHref", () => {
  it("builds a query string carrying every dimension", () => {
    expect(contributionsHref({ status: "new", bucket: "ready", client: "era", source: "quests", stage: [], sort: DEFAULT_SORT }, { status: "rejected" })).toBe(
      "/contributions/quests?status=rejected&client=era",
    );
  });

  it("puts the section in the path and the stage in the query only when one is picked", () => {
    const readables = { status: "new", bucket: "ready", client: "all", source: "readables", stage: [], sort: DEFAULT_SORT } as const;
    expect(contributionsHref(readables, {})).toBe("/contributions/readables?status=new&client=all");
    expect(contributionsHref({ ...readables, source: "quests" }, { stage: ["complete", "gossip"] })).toBe(
      "/contributions/quests?status=new&client=all&stage=complete%2Cgossip",
    );
  });

  it("keeps a picked build across another filter's change, and drops it when cleared", () => {
    const filters = { status: "new", bucket: "ready", client: "forever", build: "70790", source: "quests", stage: [], sort: DEFAULT_SORT } as const;
    expect(contributionsHref(filters, { status: "accepted" })).toBe("/contributions/quests?status=accepted&client=forever&build=70790");
    expect(contributionsHref(filters, { build: undefined })).toBe("/contributions/quests?status=new&client=forever");
  });

  it("writes the bucket only when it is not the ready rows", () => {
    expect(
      contributionsHref({ status: "new", bucket: "ready", client: "all", source: "quests", stage: [], sort: DEFAULT_SORT }, { bucket: "blocked" }),
    ).toBe("/contributions/quests?status=new&client=all&bucket=blocked");
  });
});

describe("sort", () => {
  const filters = { status: "new", bucket: "ready", client: "all", source: "quests", stage: [], sort: DEFAULT_SORT } as const;

  it("starts a newly clicked column in its own direction, and flips the one in force", () => {
    expect(nextSort(DEFAULT_SORT, "filed")).toEqual({ column: "filed", direction: "desc" });
    expect(nextSort(DEFAULT_SORT, "count")).toEqual({ column: "count", direction: "asc" });
    expect(nextSort({ column: "count", direction: "asc" }, "count")).toEqual({ column: "count", direction: "desc" });
  });

  it("reads the query string, falling back to most sent first", () => {
    expect(sortOf("filed", "asc")).toEqual({ column: "filed", direction: "asc" });
    expect(sortOf("filed", undefined)).toEqual({ column: "filed", direction: "desc" });
    expect(sortOf("filed", "sideways")).toEqual({ column: "filed", direction: "desc" });
    for (const column of [undefined, "", "npc", "createdAt; drop table"]) expect(sortOf(column, "asc")).toEqual(DEFAULT_SORT);
  });

  it("carries a sort in the href and leaves the default out", () => {
    expect(contributionsHref(filters, { sort: { column: "filed", direction: "asc" } })).toBe(
      "/contributions/quests?status=new&client=all&sort=filed&dir=asc",
    );
    expect(contributionsHref({ ...filters, sort: { column: "filed", direction: "asc" } }, { sort: DEFAULT_SORT })).toBe(
      "/contributions/quests?status=new&client=all",
    );
  });

  it("keeps the sort across a filter change", () => {
    const sort = { column: "filed", direction: "asc" } as const;
    expect(nextContributionFilters({ ...filters, sort }, { status: "accepted" }).sort).toEqual(sort);
  });
});

describe("paging", () => {
  it("carries a page past the first, and leaves the first page bare", () => {
    const filters = { status: "new", bucket: "ready", client: "all", source: "quests", stage: [], sort: DEFAULT_SORT } as const;
    expect(contributionsHref(filters, {}, 3)).toBe("/contributions/quests?status=new&client=all&page=3");
    expect(contributionsHref(filters, {}, 1)).toBe("/contributions/quests?status=new&client=all");
    // A filter change starts again from the first page.
    expect(contributionsHref(filters, { status: "accepted" })).toBe("/contributions/quests?status=accepted&client=all");
  });

  it("reads anything that is not a positive integer as the first page", () => {
    expect(pageOf("4")).toBe(4);
    for (const value of [undefined, "", "0", "-2", "1.5", "abc"]) expect(pageOf(value)).toBe(1);
  });
});

describe("bucketOf", () => {
  const npc = { race: "tauren", gender: "male", flavor: "warrior" as string | null, conflict: [] };
  const quest = { title: "A Threat Within", questId: 783, stage: "accept" as const };
  const moment = { source: "quests" as const, locale: "enUS", quest, hasSpeaker: false };
  const roster = new Roster({
    races: [
      { key: "tauren", genders: ["male"] },
      { key: "gameobject", genders: [] },
    ],
    flavors: [{ race: "tauren", gender: "male", flavor: "warrior" }],
    voices: [
      { name: "tauren-male-warrior", race: "tauren", gender: "male" },
      { name: "narrator-male", race: "narrator", gender: "male" },
    ],
    assignments: [
      { race: "tauren", gender: "male", flavor: "warrior", voice: "tauren-male-warrior" },
      { race: "gameobject", gender: null, flavor: null, voice: "narrator-male" },
    ],
  });

  it("is ready for a quest moment that already has a speaker, in any language, with no NPC answer", () => {
    expect(bucketOf({ ...moment, hasSpeaker: true }, null, roster)).toBe("ready");
    expect(bucketOf({ ...moment, locale: "deDE", hasSpeaker: true }, null, roster)).toBe("ready");
  });

  it("checks the speaker of a moment with none yet, the same in every language", () => {
    for (const locale of ["enUS", "deDE"]) {
      expect(bucketOf({ ...moment, locale }, npc, roster)).toBe("ready");
      expect(bucketOf({ ...moment, locale }, null, roster)).toBe("blocked");
    }
  });

  it("blocks a speaker with no race or gender, a conflict, or a voice off the roster", () => {
    expect(bucketOf(moment, { ...npc, gender: null }, roster)).toBe("blocked");
    expect(bucketOf(moment, { ...npc, race: null }, roster)).toBe("blocked");
    expect(bucketOf(moment, { ...npc, conflict: [{}] }, roster)).toBe("blocked");
    expect(bucketOf(moment, { ...npc, race: "murloc" }, roster)).toBe("blocked");
    // tauren-male has only flavored voices, so the bare pair is not one.
    expect(bucketOf(moment, { ...npc, flavor: null }, roster)).toBe("blocked");
  });

  it("is ready for a genderless type a voice reads", () => {
    expect(bucketOf(moment, { race: "gameobject", gender: null, flavor: null, conflict: [] }, roster)).toBe("ready");
  });

  it("checks a greeting's own speaker, in any language", () => {
    expect(bucketOf({ ...moment, quest: "gossip", hasSpeaker: true }, null, roster)).toBe("blocked");
    expect(bucketOf({ ...moment, quest: "gossip" }, npc, roster)).toBe("ready");
    expect(bucketOf({ ...moment, quest: "gossip", locale: "deDE" }, npc, roster)).toBe("ready");
    expect(bucketOf({ ...moment, quest: "gossip", locale: "deDE" }, { ...npc, race: null }, roster)).toBe("blocked");
  });

  it("is ready for places and readables, which name no NPC", () => {
    expect(bucketOf({ ...moment, source: "places", quest: null }, null, roster)).toBe("ready");
    expect(bucketOf({ ...moment, source: "readables", quest: null, locale: "deDE" }, null, roster)).toBe("ready");
  });
});

describe("matchesStage", () => {
  const quest = (stage: "accept" | "progress" | "complete" | null) => ({ title: "Stalk With The Earthmother", questId: 76156, stage });

  it("lets everything through when no stage is picked", () => {
    expect(matchesStage(null, [])).toBe(true);
    expect(matchesStage("gossip", [])).toBe(true);
    expect(matchesStage(quest(null), [])).toBe(true);
  });

  it("matches a quest row on its own stage, among any picked", () => {
    expect(matchesStage(quest("progress"), ["progress"])).toBe(true);
    expect(matchesStage(quest("progress"), ["accept", "progress"])).toBe(true);
    expect(matchesStage(quest("progress"), ["complete"])).toBe(false);
    expect(matchesStage(quest(null), ["accept"])).toBe(false);
  });

  it("matches gossip only when it is picked, and a row with no quest concept never", () => {
    expect(matchesStage("gossip", ["gossip"])).toBe(true);
    expect(matchesStage("gossip", ["accept", "gossip"])).toBe(true);
    expect(matchesStage("gossip", ["accept"])).toBe(false);
    expect(matchesStage(null, ["gossip"])).toBe(false);
  });
});

describe("matchesSearch", () => {
  const row = {
    text: "Bring me 240 gold, mortal.",
    npc: { npcId: 240, npcName: "Marshal Dughan" },
    quest: { title: "A Threat Within", questId: 783, stage: "accept" as const },
  };

  it("reads a bare number as an NPC or quest id, never as text", () => {
    expect(matchesSearch(row, "240")).toBe(true);
    expect(matchesSearch(row, "783")).toBe(true);
    expect(matchesSearch(row, "240", "quest")).toBe(false);
    expect(matchesSearch({ ...row, npc: undefined }, "240")).toBe(false);
  });

  it("matches words in the NPC's name, the quest's title or the text, without case", () => {
    expect(matchesSearch(row, "dughan")).toBe(true);
    expect(matchesSearch(row, "threat")).toBe(true);
    expect(matchesSearch(row, "MORTAL")).toBe(true);
    expect(matchesSearch(row, "murloc")).toBe(false);
  });

  it("keeps to the field asked for", () => {
    expect(matchesSearch(row, "mortal", "npc")).toBe(false);
    expect(matchesSearch(row, "dughan", "text")).toBe(false);
    expect(matchesSearch(row, "240", "text")).toBe(true);
    expect(matchesSearch(row, "threat", "quest")).toBe(true);
  });

  it("matches everything on a blank query, and a gossip row on no quest", () => {
    expect(matchesSearch(row, "  ")).toBe(true);
    expect(matchesSearch({ ...row, quest: "gossip" }, "783")).toBe(false);
  });
});

describe("contributionsHref search", () => {
  const filters = { status: "new", bucket: "ready", client: "all", source: "quests", stage: [], sort: DEFAULT_SORT } as const;

  it("writes the query and where it is searched only when set, and keeps them across a filter change", () => {
    expect(contributionsHref(filters, { q: " dughan ", searchIn: "npc" })).toBe(
      "/contributions/quests?status=new&client=all&q=dughan&filter=npc",
    );
    expect(contributionsHref({ ...filters, q: "dughan", searchIn: "any" }, { status: "accepted" })).toBe(
      "/contributions/quests?status=accepted&client=all&q=dughan",
    );
  });
});

describe("stagesOf", () => {
  it("reads a comma-separated list in the dropdown's order, dropping what is not a stage", () => {
    expect(stagesOf("gossip,accept")).toEqual(["accept", "gossip"]);
    expect(stagesOf("complete,places")).toEqual(["complete"]);
    expect(stagesOf(undefined)).toEqual([]);
  });
});

