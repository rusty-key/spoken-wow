import assert from "node:assert/strict";
import test from "node:test";

import { bossesOf, keyOf, renameAsCreatures, retailRows } from "./bosses.mjs";

const row = (ID, Name_lang, DifficultyID, OrderIndex) => ({ ID, Name_lang, DifficultyID, OrderIndex });

test("a key is the English name lowercased, without punctuation", () => {
  assert.equal(keyOf("Baron Aquanis"), "baron aquanis");
  assert.equal(keyOf("Jammal'an the Prophet"), "jammalan the prophet");
  assert.equal(keyOf("Mr. Smite"), "mr smite");
});

test("a boss the client lists for each difficulty is one boss, named from the fullest difficulty", () => {
  const rows = [
    row(1, "Ghamoo-ra", "0", "-6000"),
    row(2, "Lady Sarevess", "0", "-5000"),
    row(3, "Ghamoo-ra", "201", "0"),
    row(4, "Lady Sarevess", "201", "1000"),
    row(5, "Aku'mai", "201", "2000"),
  ];
  assert.deepEqual(bossesOf(rows).map((boss) => boss.name), ["Ghamoo-ra", "Lady Sarevess", "Aku'mai"]);
  assert.equal(bossesOf(rows)[0].id, 3);
});

test("bosses stand in Forever's order (difficulties 0 and 1), a boss only other difficulties list after them", () => {
  const rows = [
    row(1, "Baron Aquanis", "198", "0"),
    row(2, "Ghamoo-ra", "198", "1000"),
    row(3, "Gelihast", "198", "2000"),
    row(4, "Old Serra'kis", "201", "0"),
    row(5, "Ghamoo-ra", "201", "1000"),
    row(6, "Geilhast", "201", "2000"),
    row(7, "Old Serra'kis", "1", "-2000"),
    row(8, "Geilhast", "0", "-4000"),
    row(9, "Ghamoo-ra", "0", "-6000"),
  ];
  const bosses = bossesOf(rows);
  assert.deepEqual(bosses.map((boss) => boss.name), ["Ghamoo-ra", "Gelihast", "Old Serra'kis", "Baron Aquanis"]);
  assert.deepEqual(bosses.map((boss) => boss.id), [2, 3, 4, 1]);
});

test("retail names Forever's encounters by id, else one only Forever has by its English name", () => {
  const english = [{ ID: "422", Name_lang: "Lord Cobrahn" }, { ID: "3588", Name_lang: "Dreamscythe" },
    { ID: "3062", Name_lang: "Pyroguard Emberseer" }];
  const retailEnglish = [{ ID: "422", Name_lang: "Lord Cobrahn" }, { ID: "487", Name_lang: "Dreamscythe" }];
  const retailItalian = [{ ID: "422", Name_lang: "Ser Cobrahn" }, { ID: "487", Name_lang: "Falciasogni" }];
  assert.deepEqual(retailRows(english, retailEnglish, retailItalian),
    [{ ID: "422", Name_lang: "Ser Cobrahn" }, { ID: "3588", Name_lang: "Falciasogni" }]);
});

test("a combined row is left out where one of its bosses is listed on its own", () => {
  const rows = [
    row(1, "Dreamscythe", "0", "0"),
    row(2, "Weaver", "0", "1000"),
    row(3, "Dreamscythe and Weaver", "215", "0"),
    row(4, "Hakkar", "215", "1000"),
  ];
  assert.deepEqual(bossesOf(rows).map((boss) => boss.name), ["Dreamscythe", "Weaver", "Hakkar"]);
});

test("a name the client spells two ways is one boss", () => {
  const rows = [row(1, "Gelihast", "0", "0"), row(2, "Geilhast", "201", "0")];
  assert.equal(bossesOf(rows).length, 1);
});

test("a boss keeps the id of each difficulty, and a combined row's id goes to its bosses", () => {
  const rows = [
    row(1, "Dreamscythe", "0", "0"),
    row(2, "Weaver", "0", "1000"),
    row(3, "Dreamscythe and Weaver", "215", "0"),
    row(4, "Dreamscythe", "215", "1000"),
  ];
  const bosses = bossesOf(rows);
  assert.deepEqual(bosses.find((boss) => boss.name === "Dreamscythe").ids.sort(), [1, 3, 4]);
  assert.deepEqual(bosses.find((boss) => boss.name === "Weaver").ids.sort(), [2, 3]);
});

test("a boss the game names as its creature takes the creature's names and keeps its key", () => {
  const maps = { 2999: [{ id: 3355, ids: [3355], key: "the butcher", name: "The Butcher" }],
    289: [{ id: 2805, ids: [2805], key: "kirtonos", name: "Kirtonos" }] };
  const names = { deDE: { 3355: "Der Schlächter", 2805: "Kirtonos" } };
  renameAsCreatures(maps, names, {
    3355: { creature: 250660, names: { enUS: "The Baron" } },
    2805: { creature: 10506, names: { enUS: "Kirtonos the Herald", deDE: "Kirtonos der Herold" } },
  });
  assert.equal(maps[2999][0].name, "The Baron");
  assert.equal(maps[2999][0].key, "the butcher");
  assert.equal(names.deDE[3355], undefined, "no German name in the database: the English shows");
  assert.equal(names.deDE[2805], "Kirtonos der Herold");
});
