import test from "node:test";
import assert from "node:assert/strict";

import { bossChanges, nameChanges, reconcileBosses } from "./reconcile.mjs";

const row = (over) => ({
  id: 1,
  map: 70,
  key: "x",
  position: 1,
  encounterIds: [over.id ?? 1],
  creatureId: null,
  displayId: null,
  zone: null,
  retired: false,
  ...over,
});
const client = (over) => ({ id: 1, ids: [over.id ?? 1], map: 70, name: "X", position: 1, ...over });

test("a boss keeps its key when the client renames it", () => {
  const { upserts } = reconcileBosses(
    [row({ id: 2756, key: "targorr the dread" })],
    [client({ id: 2756, name: "Targorr the Terrible" })],
  );
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].key, "targorr the dread");
});

test("a new encounter mints its key from the English name", () => {
  const { upserts } = reconcileBosses([], [client({ id: 9999, name: "Mr. Smite" })]);
  assert.equal(upserts[0].key, "mr smite");
  assert.equal(upserts[0].id, 9999);
});

test("a boss the client no longer lists is retired, not dropped", () => {
  const { upserts, retire } = reconcileBosses(
    [row({ id: 2758, key: "gone" }), row({ id: 2756, key: "kept" })],
    [client({ id: 2756, name: "Kept" })],
  );
  assert.deepEqual(retire, [2758]);
  assert.ok(!upserts.some((u) => u.id === 2758));
});

test("a boss matched through another difficulty's encounter id", () => {
  const { upserts } = reconcileBosses(
    [row({ id: 3, key: "old key", encounterIds: [3, 1] })],
    [client({ id: 1, ids: [1, 3], name: "Newer Name" })],
  );
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].key, "old key");
  assert.equal(upserts[0].id, 3);
});

test("a retired boss that comes back is un-retired, and one already retired is not retired again", () => {
  const { upserts, retire } = reconcileBosses(
    [row({ id: 5, key: "back", retired: true }), row({ id: 6, key: "still gone", retired: true })],
    [client({ id: 5, name: "Back" })],
  );
  assert.equal(upserts[0].retired, false);
  assert.deepEqual(retire, []);
});

test("a second run against the same client changes nothing", () => {
  const existing = [row({ id: 5, key: "x", position: 0, encounterIds: [5, 6] })];
  const { upserts } = reconcileBosses(existing, [client({ id: 5, ids: [5, 6], position: 0 })]);
  assert.deepEqual(bossChanges(existing, upserts), { inserted: [], updated: [] });
});

test("a boss moved in the client's order is changed, a new one inserted", () => {
  const existing = [row({ id: 5, key: "x", position: 0, encounterIds: [5] })];
  const { upserts } = reconcileBosses(existing, [
    client({ id: 7, ids: [7], name: "New", position: 0 }),
    client({ id: 5, ids: [5], position: 1 }),
  ]);
  const { inserted, updated } = bossChanges(existing, upserts);
  assert.deepEqual(inserted.map((b) => b.id), [7]);
  assert.deepEqual(updated.map((b) => b.id), [5]);
});

test("only names recordName would write are listed", () => {
  const at = (name, origin = "extracted", latest = name) => ({ name, origin, latest });
  const state = {
    boss: new Map([
      ["5", new Map([["enUS", at("X")], ["deDE", at("Ix")], ["ruRU", at("Икс", "edited", "Iks")]])],
      ["6", new Map([["enUS", at("Y", "edited")]])],
    ]),
  };
  const changed = nameChanges(state, [
    { kind: "boss", id: "5", lang: "enUS", name: "X" },
    { kind: "boss", id: "5", lang: "deDE", name: "Iks" },
    { kind: "boss", id: "5", lang: "frFR", name: "Xe" },
    { kind: "boss", id: "5", lang: "ruRU", name: "Iks" },
    { kind: "boss", id: "6", lang: "enUS", name: "Why" },
    { kind: "instance", id: "70", lang: "enUS", name: "Uldaman" },
  ]);
  assert.deepEqual(changed.map((n) => `${n.kind} ${n.id} ${n.lang}`), ["boss 5 deDE", "boss 5 frFR", "boss 6 enUS", "instance 70 enUS"]);
});

test("a new boss named as its creature is filed under the encounter's key", () => {
  const { upserts } = reconcileBosses([], [client({ id: 3355, name: "The Baron", key: "the butcher" })]);
  assert.equal(upserts[0].key, "the butcher");
});

test("a new encounter whose key another boss holds fails, naming the boss to extend", () => {
  assert.throws(
    () => reconcileBosses(
      [row({ id: 2756, key: "targorr the dread", retired: true })],
      [client({ id: 9001, name: "Targorr the Dread" })],
    ),
    { message: 'key "targorr the dread" on map 70 already belongs to boss 2756; add encounter 9001 to its encounterIds' },
  );
});

test("the same key on another map is no clash", () => {
  const { upserts } = reconcileBosses(
    [row({ id: 2756, map: 34, key: "targorr the dread" })],
    [client({ id: 9001, name: "Targorr the Dread" })],
  );
  assert.equal(upserts.find((u) => u.id === 9001).key, "targorr the dread");
});

test("a matched boss the client moved onto a map where its key is taken fails", () => {
  assert.throws(
    () => reconcileBosses(
      [row({ id: 1, map: 70, key: "x" }), row({ id: 2, map: 34, key: "x", encounterIds: [2] })],
      [client({ id: 1, map: 34, name: "X" }), client({ id: 2, map: 34, name: "X" })],
    ),
    { message: /key "x" on map 34 already belongs to boss/ },
  );
  assert.throws(
    () => reconcileBosses(
      [row({ id: 1, map: 70, key: "x" }), row({ id: 2, map: 34, key: "x", encounterIds: [2], retired: true })],
      [client({ id: 1, map: 34, name: "X" })],
    ),
    { message: 'key "x" on map 34 already belongs to boss 2; add encounter 1 to its encounterIds' },
  );
});

test("two client bosses resolving to one stored boss fail, naming both", () => {
  assert.throws(
    () => reconcileBosses(
      [row({ id: 3, key: "x", encounterIds: [3, 4] })],
      [client({ id: 3, name: "X" }), client({ id: 4, name: "X2", position: 2 })],
    ),
    { message: "client bosses 3 and 4 both resolve to stored boss 3; merge or split their encounter ids" },
  );
});
