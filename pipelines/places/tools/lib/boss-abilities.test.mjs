import assert from "node:assert/strict";
import test from "node:test";

import { abilities } from "../boss-abilities.mjs";

const page = (body) => `Intro.\n==Abilities==\n${body}\n==Loot==\n*{{Abilities|Not one|id=1}}\n`;

test("the spells of adds the boss calls are left out, its own nested ones kept", () => {
  const text = page(
    [
      "*{{Abilities|Sunder Armor|Hacks.|id=15572}}",
      "*{{abilities|Intruder Alert!|Calls for help.}}",
      "**{{abilities|[[Anvilrage Reservist]]|They assist him.}}",
      "***{{Abilities|Strike|The Reservist strikes.|id=12057}}",
      "*{{Abilities|Frost Armor|Encases the caster.|id=12544}}",
      "**{{Abilities|Chilled|Slows attackers.|id=6136}}",
      "*'''[[Verek]]'''",
      "**{{Abilities|Curse of Blood|A curse.|id=15042}}",
      "*{{Abilities|id=22714|Summon Hydroling|Summons two.}}",
      "**{{Abilities|Hydrojet|id=22715|The Hydroling knocks back.}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "General Angerforge"), [15572, 12544, 6136, 22714]);
});

test("a phase named for another creature is left out, the boss's own phase kept", () => {
  const text = page(
    [
      "===Phase One: Feugen and Stalagg===",
      "*{{Abilities|Warstomp|id=28125|Knocks back.}}",
      "===Phase Two: Thaddius===",
      "*{{Abilities|Polarity Shift|id=28089|Polarizes.}}",
      "**{{Abilities|Negative Charge|id=28084|Charges.}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Thaddius"), [28089, 28084]);
});

test("phases and sub-headings of one boss's fight are read, in any case of the template", () => {
  const text = page(
    [
      "*{{Abilities|Frost Aura|id=28531|Deals damage.}}",
      "====Air phase====",
      "*{{abilities|Icebolt|id=28522|Encases the target.}}",
      "===Phase One: Priest Form===",
      "*{{Abilities|Hatch Eggs|id=24083|Hatches.}}",
      "===Phase Two: Shadra Form===",
      "*{{Abilities|Corrosive Poison|id=24111|Poisons.}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Sapphiron"), [28531, 28522, 24083, 24111]);
});

test("a creature named on its own line keeps its spells from the boss's", () => {
  const text = page(
    [
      "'''Bloodlord Mandokir'''",
      "*{{Abilities|Whirlwind|Strikes all.|id=13736}}",
      "'''Ohgan'''",
      "*{{Abilities|Sunder Armor|Hacks.|id=24317}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Bloodlord Mandokir"), [13736]);
});

test("an encounter of several takes one spell of each member in turn", () => {
  const text = page(
    [
      "===The Ugly Goblin===",
      ";[[Beengis]]",
      "*{{Abilities|Improved Blocking|id=3248}}",
      "*{{Abilities|Revenge|id=12170}}",
      ";[[Jank]]",
      "*{{Abilities|Backstab|id=7159}}",
      "===Trizivast===",
      "*{{Abilities|Fear|id=1222563}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "The Ugly Goblin"), [3248, 7159, 12170]);
});

test("a spell marked for Season of Mastery only is left out", () => {
  const text = page(
    [
      "* {{Abilities|Thrash|Two extra attacks.|id=3391}}",
      "* {{Abilities|Brand of Shadow|More damage.|id=368515}} (Season of Mastery only)",
      "===Season of Mastery===",
      "* {{Abilities|Other|id=2}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Ebonroc"), [3391]);
});

test("a phase or form heading hands the lines back to the boss from the creature before it", () => {
  const text = page(
    [
      "'''Bloodlord Mandokir'''",
      "*{{Abilities|Whirlwind|id=1}}",
      "'''Ohgan'''",
      "*{{Abilities|Sunder Armor|id=2}}",
      "====Phase 2====",
      "*{{Abilities|Charge|id=3}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Bloodlord Mandokir"), [1, 3]);
});

test("an add named after its boss is not the boss, and does not hide the boss's phases", () => {
  const text = page(
    ["===Phase 1===", "*{{Abilities|Fireball|id=1}}", "===Onyxian Whelps===", "*{{Abilities|Flame Breath|id=2}}"].join("\n"),
  );
  assert.deepEqual(abilities(text, "Onyxia"), [1]);
  const son = page(["'''Hakkar'''", "*{{Abilities|Cause Insanity|id=1}}", "'''Son of Hakkar'''", "*{{Abilities|Poison|id=2}}"].join("\n"));
  assert.deepEqual(abilities(son, "Hakkar"), [1]);
});

test("an ability named by a link to its spell keeps its sub-bullets, a bold label is no creature", () => {
  const text = page(
    [
      "*{{Abilities|[[Corrupted Blood (debuff)|Corrupted Blood]]|id=24328|Poisons.}}",
      "**{{Abilities|Weakness|id=1|Weakens.}}",
      "*'''Note:'''",
      "**{{Abilities|Frenzy|id=81}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Hakkar"), [24328, 1, 81]);
});

test("words of a crowd are read whole: Petrification and Vanguard are not pets and guards", () => {
  assert.deepEqual(abilities(page(["===Petrification phase===", "*{{Abilities|Stone|id=7}}"].join("\n")), "Medusa"), [7]);
  assert.deepEqual(
    abilities(page(["===Phase Two: Vanguard===", "*{{Abilities|Charge|id=8}}", "===Guards===", "*{{Abilities|Slash|id=9}}"].join("\n")), "Rex"),
    [8],
  );
});

test("a blank line, prose or a season mark does not let sub-bullets of a left-out parent back in", () => {
  assert.deepEqual(
    abilities(page(["*{{Abilities|Summon Imp|id=100}}", "", "**{{Abilities|Firebolt|id=101}}"].join("\n")), "Warlock"),
    [100],
  );
  assert.deepEqual(
    abilities(page(["*{{Abilities|Summon Imp|id=100}}", "The imp casts:", "**{{Abilities|Firebolt|id=101}}"].join("\n")), "Warlock"),
    [100],
  );
  assert.deepEqual(
    abilities(page(["*{{Abilities|Brand|id=70}} (Season of Mastery only)", "**{{Abilities|Sub|id=71}}"].join("\n")), "Ebonroc"),
    [],
  );
});

test("spells under a bold name are an add's even where no line names the boss", () => {
  const text = page(
    [
      "===Phase Two: Priest form===",
      "*{{Abilities|Hatch Eggs|id=24083}}",
      "'''Gurubashi Bat Rider'''",
      "*{{Abilities|Throw Liquid Fire|id=23970}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "High Priestess Jeklik"), [24083]);
});

test("a label with no bullet names no creature, as one with a bullet", () => {
  const text = page(
    [
      "'''Bloodlord Mandokir'''",
      "*{{Abilities|Whirlwind|id=1}}",
      "'''Note:'''",
      "*{{Abilities|Charge|id=2}}",
      ";Tips",
      "*{{Abilities|Gouge|id=3}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Bloodlord Mandokir"), [1, 2, 3]);
});

test("the heading of a season is a crowd in the plural too, as the only heading", () => {
  const spell = (heading) => page(["*{{Abilities|Lava Bomb|id=19411}}", heading, "*{{Abilities|Fireball Volley|id=15285}}"].join("\n"));
  assert.deepEqual(abilities(spell("===Seasons of Mastery==="), "Magmadar"), [19411]);
  assert.deepEqual(abilities(spell("===Season of Mastery==="), "Magmadar"), [19411]);
});

test("the only heading of a page is read as the boss's own unless it is a crowd", () => {
  const spell = (heading) => page(["*{{Abilities|Lava Bomb|id=19411}}", heading, "*{{Abilities|Fireball Volley|id=15285}}"].join("\n"));
  assert.deepEqual(abilities(spell("===Tactics==="), "Magmadar"), [19411, 15285]);
  assert.deepEqual(abilities(spell("===Hardcore==="), "Magmadar"), [19411]);
});

test("a four-equals line names a creature of the fight, not a heading that parts it", () => {
  const text = page(
    [
      "===Shared Abilities===",
      "* {{Abilities|Enrage|id=8599}}",
      "===Unique Abilities===",
      "====Highlord Mograine====",
      "* {{Abilities|Mark of Mograine|id=28834}}",
      "====Thane Korth'azz====",
      "* {{Abilities|Meteor|id=28884}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "The Four Horsemen"), [8599, 28834, 28884]);
});

test("a heading holds the boss's name or is held by it, in any case and punctuation", () => {
  const spells = (heading, boss) =>
    abilities(page([heading, "*{{Abilities|Whirlwind|id=1}}", "===Totems===", "*{{Abilities|Totem|id=2}}"].join("\n")), boss);
  assert.deepEqual(spells("===Mandokir===", "Bloodlord Mandokir"), [1]);
  assert.deepEqual(spells("===JIN’DO THE HEXXER===", "Jin'do the Hexxer"), [1]);
  assert.deepEqual(spells("===The Hexxer===", "Hexxer"), [1]);
});

test("a name of the boss's after 'of the' is another creature's", () => {
  const text = page(["'''Hakkar'''", "*{{Abilities|Cause Insanity|id=1}}", "'''Eyes of the Hakkar'''", "*{{Abilities|Gaze|id=2}}"].join("\n"));
  assert.deepEqual(abilities(text, "Hakkar"), [1]);
});

test("a link names its creature by the words it shows", () => {
  const text = page(
    [
      "'''[[Mandokir (boss)|Bloodlord Mandokir]]'''",
      "*{{Abilities|Whirlwind|id=1}}",
      "'''Ohgan'''",
      "*{{Abilities|Sunder Armor|id=2}}",
    ].join("\n"),
  );
  assert.deepEqual(abilities(text, "Bloodlord Mandokir"), [1]);
});

test("a spell the parts of a fight share is listed once", () => {
  const text = page(["*{{Abilities|Fireball|id=5}}", "===Phase One===", "*{{Abilities|Fireball|id=5}}", "===Phase Two===", "*{{Abilities|Flame|id=6}}"].join("\n"));
  assert.deepEqual(abilities(text, "Onyxia"), [5, 6]);
});
