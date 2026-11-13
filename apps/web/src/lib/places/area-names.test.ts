import { describe, expect, it } from "vitest";

import { areaNames, mapNames, namesForLines } from "@tools/lib/area-names.mjs";

describe("a language's place names, from the client's tables", () => {
  it("keeps names that are the same in both languages, first row winning", () => {
    const english = [
      { ID: "362", AreaName_lang: "Razor Hill" },
      { ID: "1637", AreaName_lang: "Orgrimmar" },
      { ID: "5000", AreaName_lang: "Razor Hill" },
      { ID: "9", AreaName_lang: "Northshire Valley" },
    ];
    const spanish = [
      { ID: "362", AreaName_lang: "Cerrotajo" },
      { ID: "1637", AreaName_lang: "Orgrimmar" },
      { ID: "5000", AreaName_lang: "Cerrotajo (viejo)" },
      { ID: "9", AreaName_lang: "Valle de Villanorte" },
    ];
    const wanted = new Set(["razor hill", "orgrimmar"]);
    expect(Object.fromEntries(areaNames(english, spanish, wanted))).toEqual({
      "razor hill": "Cerrotajo",
      orgrimmar: "Orgrimmar",
    });
  });

  it("names maps by uiMapID, continents included", () => {
    const spanish = [
      { ID: "947", Name_lang: "Azeroth" },
      { ID: "1415", Name_lang: "Reinos del Este" },
      { ID: "1412", Name_lang: "Mulgore" },
      { ID: "1", Name_lang: "Durotar" },
    ];
    expect(Object.fromEntries(mapNames(spanish, new Set([947, 1415, 1412])))).toEqual({
      947: "Azeroth",
      1415: "Reinos del Este",
      1412: "Mulgore",
    });
  });

  it("names a zone by its map and a subzone by its key", () => {
    const lines = [
      { lineId: "z:1415", kind: "zone", mapID: 1415, key: null },
      { lineId: "s:1411:razor hill", kind: "subzone", mapID: 1411, key: "razor hill" },
      { lineId: "s:1429:goldshire", kind: "subzone", mapID: 1429, key: "goldshire" },
    ];
    const names = { zones: { 1415: "Reinos del Este" }, subzones: { "razor hill": "Cerrotajo" } };
    expect(namesForLines(lines, names)).toEqual([
      { kind: "zone", entityId: "z:1415", name: "Reinos del Este" },
      { kind: "subzone", entityId: "s:1411:razor hill", name: "Cerrotajo" },
    ]);
  });
});
