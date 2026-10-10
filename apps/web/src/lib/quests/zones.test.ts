import { describe, expect, it } from "vitest";

import type { CorpusLine } from "../corpus";
import { matchingLines } from "../search";
import { QUEST_ZONES, zonesBySpeaker } from "./zones";

const spawn = (npcId: number, map: number, x: number, y: number) => ({ npcType: "creature", npcId, map, x, y });

describe("zonesBySpeaker", () => {
  it("places a spawn in the zone whose map it stands on", () => {
    // Razor Hill, Durotar
    expect(zonesBySpeaker([spawn(1, 1, 340, -4690)]).get("creature:1")).toEqual([1411]);
  });

  it("prefers the city over the zone around it", () => {
    // Stormwind's rectangle sits inside Elwynn Forest's
    expect(zonesBySpeaker([spawn(1, 0, -8900, 600)]).get("creature:1")).toEqual([1453]);
  });

  it("places a spawn where zone maps overlap by the subzone it stands in", () => {
    // Thork at the Crossroads lies inside Durotar's map too, which is the smaller one.
    expect(zonesBySpeaker([spawn(1, 1, -473.2, -2595.7)]).get("creature:1")).toEqual([1413]);
    // High Priestess MacDonnell at Chillwind Camp is also on Alterac Mountains' map.
    expect(zonesBySpeaker([spawn(1, 0, 944.3, -1431.1)]).get("creature:1")).toEqual([1422]);
  });

  it("breaks an even overlap by the smaller subzone", () => {
    // Kargath, Badlands, sits under one Badlands overlay and Searing Gorge's map-wide one.
    expect(zonesBySpeaker([spawn(1, 0, -6650, -2149)]).get("creature:1")).toEqual([1418]);
  });

  it("puts a dungeon under the zone its entrance is in", () => {
    // Gnomeregan
    expect(zonesBySpeaker([spawn(1, 90, -500, 50)]).get("creature:1")).toEqual([1426]);
  });

  it("gives every zone a speaker spawns in, once each", () => {
    const zones = zonesBySpeaker([spawn(1, 1, 340, -4690), spawn(1, 1, 400, -4700), spawn(1, 0, -8900, 600)]);
    expect(zones.get("creature:1")).toEqual([1411, 1453]);
  });

  it("leaves out a spawn that stands in no zone", () => {
    expect(zonesBySpeaker([spawn(1, 0, 99999, 99999)]).has("creature:1")).toBe(false);
  });

  it("keeps creatures and gameobjects with the same id apart", () => {
    const zones = zonesBySpeaker([spawn(68, 1, 340, -4690), { ...spawn(68, 0, -8900, 600), npcType: "gameobject" }]);
    expect(zones.get("creature:68")).toEqual([1411]);
    expect(zones.get("gameobject:68")).toEqual([1453]);
  });
});

describe("QUEST_ZONES", () => {
  it("names each zone once, alphabetically", () => {
    const names = QUEST_ZONES.map((zone) => zone.name);
    expect(names).toContain("Durotar");
    expect(names).toEqual([...new Set(names)].sort((a, b) => a.localeCompare(b)));
  });
});

describe("the zone filter", () => {
  const line = (npcId: number, zones?: number[]): CorpusLine => ({
    lineId: `q:${npcId}:accept`,
    source: "accept",
    questId: npcId,
    questTitle: "A quest",
    npcId,
    npcName: "Someone",
    npcType: "creature",
    race: "human",
    gender: "male",
    flavor: null,
    voice: "human-male",
    playerGender: null,
    text: "Hello.",
    originalText: "Hello.",
    fileName: `${npcId}.ogg`,
    generatable: true,
    skipReason: null,
    zones,
  });
  const corpus = { lines: [line(1, [1411]), line(2, [1411, 1453]), line(3, [1453]), line(4)] };
  const ids = (zone?: number) => matchingLines(corpus, new Set(), { zone }).map((l) => l.npcId);

  it("keeps the lines whose speaker stands in the zone", () => {
    expect(ids(1453)).toEqual([2, 3]);
  });

  it("is off without a zone", () => {
    expect(ids()).toEqual([1, 2, 3, 4]);
  });
});
