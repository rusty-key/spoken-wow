import assert from "node:assert/strict";
import { test } from "node:test";

import { aliasesOf, emitAliases, zoneAliasesOf } from "./aliases.mjs";
import { normaliseKey } from "./wiki.mjs";

const rows = (pairs) => pairs.map(([ID, AreaName_lang]) => ({ ID, AreaName_lang }));
const maps = (entries) => new Map(Object.entries(entries));

// Forever's AreaTable has Rise of Spirits (16988); Era's has not.
const foreverEnglish = rows([[1640, "Spirit Rise"], [16988, "Rise of Spirits"], [87, "Goldshire"]]);
const eraEnglish = rows([[1640, "Spirit Rise"], [87, "Goldshire"]]);
const spirits = maps({ "spirit rise": [1456], "rise of spirits": [2521], goldshire: [1429] });

test("a name two places share in different zones is told apart by zone, and stays out of the flat table", () => {
  const forever = rows([[1640, "Alto de los Espíritus"], [16988, "Alto de los Espíritus"], [87, "Villadorada"]]);
  const era = rows([[1640, "Alto de los Espíritus"], [87, "Villadorada"]]);
  const wanted = new Set(spirits.keys());
  const flat = aliasesOf(foreverEnglish, forever, wanted, normaliseKey);
  assert.deepEqual([...flat.aliases], [["Villadorada", "goldshire"]]);
  assert.deepEqual([...flat.ambiguous], ["Alto de los Espíritus"]);

  const byZone = zoneAliasesOf(
    [
      { english: foreverEnglish, localized: forever, keyOf: normaliseKey },
      { english: eraEnglish, localized: era, keyOf: normaliseKey },
    ],
    spirits,
  );
  assert.deepEqual([...byZone.keys()], ["Alto de los Espíritus"]);
  assert.deepEqual([...byZone.get("Alto de los Espíritus")], [[1456, "spirit rise"], [2521, "rise of spirits"]]);

  const lua = emitAliases("esES", flat.aliases, ["1.60.1.70450", "1.15.9.69109"], byZone);
  assert.match(lua, /^\t\["Alto de los Espíritus"\] = \{ \[1456\] = "spirit rise", \[2521\] = "rise of spirits" \},$/m);
  assert.match(lua, /^SpokenZones:RegisterAliases\("esES", aliases, byZone\)$/m);
});

test("a name one build gives one place and another build two is told apart by zone", () => {
  // Forever spells Sludge Fen "진흙 늪"; Era names it and Stagalbog both "진흙늪".
  const english = rows([[382, "The Sludge Fen"], [1797, "Stagalbog"]]);
  const byZone = zoneAliasesOf(
    [
      { english, localized: rows([[382, "진흙 늪"], [1797, "진흙늪"]]), keyOf: normaliseKey },
      { english, localized: rows([[382, "진흙늪"], [1797, "진흙늪"]]), keyOf: normaliseKey },
    ],
    maps({ "sludge fen": [1413], stagalbog: [1435] }),
  );
  assert.deepEqual([...byZone], [["진흙늪", new Map([[1413, "sludge fen"], [1435, "stagalbog"]])]]);
});

test("places that share a name and a zone are left out: the name cannot tell them apart there", () => {
  const english = rows([[70, "Stonewatch"], [71, "Stonewatch Falls"]]);
  const localized = rows([[70, "Водопад Каменной Стражи"], [71, "Водопад Каменной Стражи"]]);
  const byZone = zoneAliasesOf(
    [{ english, localized, keyOf: normaliseKey }],
    maps({ stonewatch: [1433], "stonewatch falls": [1433] }),
  );
  assert.equal(byZone.size, 0);

  // ...and a file with no such name is written as it was before the table existed.
  const lua = emitAliases("ruRU", new Map([["Крепость Каменной Стражи", "stonewatch keep"]]), ["a", "b"], byZone);
  assert.ok(lua.endsWith('}\n\nSpokenZones:RegisterAliases("ruRU", aliases)\n'));
  assert.ok(!lua.includes("byZone"));
});

test("a zone two of the places share drops out, the others stay", () => {
  const english = rows([[1, "The Bulwark"], [2, "Gallows Hill"]]);
  const localized = rows([[1, "Bollwerk"], [2, "Bollwerk"]]);
  const byZone = zoneAliasesOf(
    [{ english, localized, keyOf: normaliseKey }],
    maps({ bulwark: [1420, 1422], "gallows hill": [1420] }),
  );
  assert.deepEqual([...byZone.get("Bollwerk")], [[1422, "bulwark"]]);
});

test("Forever's spelling of a place the lore keeps under another key is the same place", () => {
  const renamed = { "legashi encampment": { key: "legash encampment" } };
  const byZone = zoneAliasesOf(
    [
      {
        english: rows([[4000, "Legashi Encampment"]]),
        localized: rows([[4000, "Lager der Legashi"]]),
        keyOf: (name) => renamed[normaliseKey(name)]?.key ?? normaliseKey(name),
      },
      {
        english: rows([[3000, "Legash Encampment"]]),
        localized: rows([[3000, "Lager der Legashi"]]),
        keyOf: normaliseKey,
      },
    ],
    maps({ "legash encampment": [1447], "legashi encampment": [1447] }),
  );
  assert.equal(byZone.size, 0);
});

test("a name that is one place's English name and another's translation is told apart by zone", () => {
  const english = rows([[1, "Alpha"], [2, "Beta"]]);
  const localized = rows([[1, "Alpha"], [2, "Alpha"]]);
  const wanted = new Set(["alpha", "beta"]);
  assert.deepEqual([...aliasesOf(english, localized, wanted, normaliseKey).aliases], [["Alpha", "beta"]]);
  const byZone = zoneAliasesOf([{ english, localized, keyOf: normaliseKey }], maps({ alpha: [10], beta: [20] }));
  assert.deepEqual([...byZone.get("Alpha")], [[10, "alpha"], [20, "beta"]]);
});
