import assert from "node:assert/strict";
import { test } from "node:test";

import { cannotBeHad, dungeonsOf, foreverQuests, isTemplateCopy, typeOf } from "./places.mjs";

test("a difficulty or test copy of a creature is not a source", () => {
  assert.equal(isTemplateCopy("Alliance Sentinel (1)"), true);
  assert.equal(isTemplateCopy("Frostwolf Bowman (3)"), true);
  assert.equal(isTemplateCopy("Commander Dardosh <old> (1)"), true);
  assert.equal(isTemplateCopy("Lieutenant Murp <old>"), true);
});

test("a creature's own template is a source", () => {
  assert.equal(isTemplateCopy("Alliance Sentinel"), false);
  assert.equal(isTemplateCopy("Defias Messenger"), false);
  assert.equal(isTemplateCopy(undefined), false);
});

const SCROLL = "interface/icons/inv_scroll_03.blp";
const TABLET = "interface/icons/inv_misc_stonetablet_05.blp";
const NOTE = "interface/icons/inv_misc_note_01.blp";
const BOOK = "interface/icons/inv_misc_book_09.blp";

test("a carried readable whose title names its form is that form, whatever its icon", () => {
  assert.equal(typeOf({ title: "Maybell's Love Letter", icons: [SCROLL] }), "letter");
  assert.equal(typeOf({ title: "Crystallized Note", icons: [TABLET] }), "note");
  assert.equal(typeOf({ title: "Kodo Skin Scroll", icons: [NOTE] }), "scroll");
  assert.equal(typeOf({ title: "Weatherworn Parchment", icons: [SCROLL] }), "note");
});

test("a plural is not a form: Jordan's Weapon Notes is a letter by its icon", () => {
  assert.equal(typeOf({ title: "Jordan's Weapon Notes", icons: ["interface/icons/inv_letter_02.blp"] }), "letter");
});

test("a carried readable whose title names no form goes by its icon, then its title", () => {
  assert.equal(typeOf({ title: "Lorgalis Manuscript", icons: [NOTE] }), "note");
  assert.equal(typeOf({ title: "The Story of Morgan Ladimore", icons: [BOOK] }), "book");
  assert.equal(typeOf({ title: "Green Hills of Stranglethorn - Page 1", icons: [] }), "note");
  assert.equal(typeOf({ title: "William's Shipment", icons: [] }), "other");
});

test("a readable in the world goes by its name and its pages", () => {
  assert.equal(typeOf({ title: "Eliza's Tombstone", world: true }), "grave");
  assert.equal(typeOf({ title: "Pteradon Skeleton", world: true }), "exhibit");
  assert.equal(typeOf({ title: "Aftermath of the Second War", world: true, texts: ["The Second War", "", "", "", "", "Turalyon"] }), "book");
  assert.equal(typeOf({ title: "Kurdran Wildhammer", world: true }), "plaque");
});

test("a marker that opens \"Here lies\" is a grave, whatever its name", () => {
  assert.equal(typeOf({ title: "Uther the Lightbringer", world: true, texts: ["Here lies Uther the Lightbringer"] }), "grave");
  assert.equal(typeOf({ title: "Rock of Durotan", world: true, texts: ["Here lies Durotan - first Chieftain"] }), "grave");
  assert.equal(typeOf({ title: "A Grave", world: true, texts: ["In loving memory of Jesse Morales"] }), "grave");
});

test("a memorial is a plaque, not a grave", () => {
  assert.equal(typeOf({ title: "Horatio Montgomery, M.D.", world: true, texts: ["In memory of my dear mentor"] }), "plaque");
});

test("the Hall of Explorers' Geru Strider is an exhibit", () => {
  assert.equal(typeOf({ title: "Geru Strider", world: true }), "exhibit");
});

test("journals and diaries are one type, carried or on a shelf", () => {
  assert.equal(typeOf({ title: "A Faded Journal Page", icons: [NOTE] }), "journal");
  assert.equal(typeOf({ title: "Damp Diary Page (Day 4)", icons: [NOTE] }), "journal");
  assert.equal(typeOf({ title: "Diary of Weavil", icons: [BOOK] }), "journal");
  assert.equal(typeOf({ title: "Baelog's Journal", world: true, texts: ["I've sent Eric and Olaf"] }), "journal");
});

test("a readable with no words on any page is a picture", () => {
  assert.equal(typeOf({ title: "Snapshot of Gammerita", texts: [""] }), "picture");
  assert.equal(typeOf({ title: "Of Love and Family", icons: [SCROLL], texts: [""] }), "picture");
  assert.equal(typeOf({ title: "Book from Sven's Farm", icons: [BOOK], texts: ["Sven's journal", ""] }), "book");
});

test("a readable whose every page is Missing Text cannot be had", () => {
  assert.equal(cannotBeHad("Sam's Tome", ["Missing Text"]), true);
  assert.equal(cannotBeHad("Inscribed Kodo Leather", ["Missing Text", "Missing Text"]), true);
  assert.equal(cannotBeHad("Book from Sven's Farm", ["Missing Text", "Stalvan's words"]), false);
});

test("test and retired items cannot be had, by their titles", () => {
  assert.equal(cannotBeHad("Deprecated Tome of the Cabal", ["Some words"]), true);
  assert.equal(cannotBeHad("TEST Language Item", ["Some words"]), true);
  assert.equal(cannotBeHad("Old Letter (old)", ["Some words"]), true);
  assert.equal(cannotBeHad("Letter to Ello", ["Some words"]), false);
});

test("the Forsaken class letters never given out cannot be had, by their ids", () => {
  assert.equal(cannotBeHad("Musty Note", ["Some words"], 691), true);
  assert.equal(cannotBeHad("Musty Note", ["Some words"], 22), false);
});

test("a readable had only inside a dungeon names it, one per zone", () => {
  const entrance = { 230: 1427, 229: 1427, 289: 1422, 70: 1418 };
  assert.deepEqual(dungeonsOf(new Set([-230]), entrance), [230]);
  assert.deepEqual(dungeonsOf(new Set([1455, -289, -230, 1457]), entrance), [230, 289]);
  assert.deepEqual(dungeonsOf(new Set([-230, -229]), entrance), [229, 230]);
});

test("a readable had in a dungeon and outside it in the same zone is the zone's", () => {
  const entrance = { 70: 1418, 289: 1422 };
  assert.deepEqual(dungeonsOf(new Set([-70, 1418]), entrance), []);
  assert.deepEqual(dungeonsOf(new Set([1418, -70, -289]), entrance), [289]);
  assert.deepEqual(dungeonsOf(new Set([1453, 1429]), entrance), []);
});

test("a quest is Forever's when the corpus voices it or the client's QuestV2 lists it", () => {
  const quests = foreverQuests([{ questId: 579 }, { questId: null }, {}], [{ ID: "417" }, { ID: "1124" }]);
  assert.deepEqual([...quests].sort((a, b) => a - b), [417, 579, 1124]);
  assert.equal(quests.has(26855), false);
});
