import { test } from "node:test";
import assert from "node:assert/strict";

import { readForever, readWorld, withForever } from "./world.mjs";

// A connection that answers each query by the table it reads, and keeps what it was asked.
function stub(tables) {
  const asked = [];
  return {
    asked,
    async query(sql, params) {
      asked.push({ sql, params });
      const table = Object.keys(tables).find((name) => sql.includes(`FROM ${name}`) || sql.includes(`FROM \`${name}\``));
      return [tables[table] ?? []];
    },
  };
}

test("readWorld asks for goobers by the page in data7 as well as text objects by data0", async () => {
  const connection = stub({
    page_text: [{ entry: 358, text: "Long had the children of the stars...", next_page: 364 }],
    gameobject_template: [{ id: 17188, name: "The Lay of Ameth'Aran", firstPage: 358 }],
    item_template: [],
  });
  const world = await readWorld(connection);

  const objects = connection.asked.find(({ sql }) => sql.includes("FROM gameobject_template"));
  assert.match(objects.sql, /t1\.type = \? AND t1\.data7 > 0/);
  assert.match(objects.sql, /IF\(t1\.type = \?, t1\.data0, t1\.data7\)/);
  assert.deepEqual(objects.params, [9, 9, 10, 10]);
  assert.deepEqual(world.owners, [
    { kind: "object", id: 17188, name: "The Lay of Ameth'Aran", firstPage: 358, material: 0 },
  ]);
});

const repack = () => stub({
  gameobject_template: [
    { id: 617704, name: "Bloody Note", firstPage: 10322 },
    { id: 658836, name: "On the Shal'nan", firstPage: 10727 },
  ],
  page_text: [
    { entry: 10322, text: "The cult hit us by surprise.", nextPage: 10323 },
    { entry: 10323, text: "As soon as the fighting stopped...", nextPage: 0 },
    { entry: 11007, text: "Elf,", nextPage: 0 },
    { entry: 9880, text: "A retail tablet nothing here names.", nextPage: 0 },
  ],
});

test("readForever keeps the named owners and only the pages they reach", async () => {
  const letter = { kind: "item", id: 285357, name: "Advisor Nazgrel's Instructions", firstPage: 11007, material: 1 };
  const forever = await readForever(repack(), [letter], [617704, 658836]);
  assert.deepEqual(forever.owners.map((owner) => [owner.kind, owner.id, owner.firstPage]), [
    ["object", 617704, 10322],
    ["object", 658836, 10727],
    ["item", 285357, 11007],
  ]);
  assert.deepEqual(forever.pages.map((page) => page.entry), [10322, 10323, 11007]);
});

test("readForever refuses a named object the repack does not have", async () => {
  await assert.rejects(readForever(repack(), [], [617704, 1]), /object 1 in the Forever repack/);
});

test("withForever adds Forever's pages and owners to vmangos's", () => {
  const world = { pages: [{ entry: 358, text: "One.", nextPage: 0 }], owners: [{ kind: "object", id: 17188, firstPage: 358 }] };
  const forever = { pages: [{ entry: 10322, text: "Two.", nextPage: 0 }], owners: [{ kind: "object", id: 617704, firstPage: 10322 }] };
  const merged = withForever(world, forever);
  assert.deepEqual(merged.pages.map((page) => page.entry), [358, 10322]);
  assert.deepEqual(merged.owners.map((owner) => owner.id), [17188, 617704]);
});

test("withForever refuses a Forever page that has a vmangos page's id", () => {
  const world = { pages: [{ entry: 358, text: "One.", nextPage: 0 }], owners: [] };
  const forever = { pages: [{ entry: 358, text: "Other words.", nextPage: 0 }], owners: [] };
  assert.throws(() => withForever(world, forever), /Forever pages 358 are vmangos pages too/);
});
