import assert from "node:assert/strict";
import test from "node:test";

import { bossesOf, keyOf } from "./bosses.mjs";

const row = (ID, Name_lang, DifficultyID, OrderIndex) => ({ ID, Name_lang, DifficultyID, OrderIndex });

test("a key is the English name lowercased, without punctuation", () => {
  assert.equal(keyOf("Baron Aquanis"), "baron aquanis");
  assert.equal(keyOf("Jammal'an the Prophet"), "jammalan the prophet");
  assert.equal(keyOf("Mr. Smite"), "mr smite");
});

test("a boss the client lists for each difficulty is one boss, in the order of the fullest difficulty", () => {
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
