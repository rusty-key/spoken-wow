import { test } from "node:test";
import assert from "node:assert/strict";

import { localizedPages, localizedTitles } from "./locale.mjs";

const english = new Set(["b:1", "b:2"]);

test("a translated page is kept, normalised as the English is", () => {
  const { pages } = localizedPages([{ entry: 1, text: "Hallo  Welt" }], english);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].lineId, "b:1");
  assert.equal(typeof pages[0].generatable, "boolean");
});

test("an empty column is no translation", () => {
  const { pages } = localizedPages(
    [{ entry: 1, text: null }, { entry: 2, text: "  " }],
    english,
  );
  assert.deepEqual(pages, []);
});

test("a page the English corpus does not carry is counted, not written", () => {
  const { pages, withoutEnglish } = localizedPages([{ entry: 99, text: "Hallo" }], english);
  assert.deepEqual(pages, []);
  assert.equal(withoutEnglish, 1);
});

test("owners are named in entity_name's spelling of their kind", () => {
  assert.deepEqual(
    localizedTitles([
      { kind: "object", id: 7, name: "Ein Buch" },
      { kind: "item", id: 8, name: "Ein Brief" },
      { kind: "item", id: 9, name: "" },
    ]),
    [
      { kind: "gameobject", entityId: "7", name: "Ein Buch" },
      { kind: "item", entityId: "8", name: "Ein Brief" },
    ],
  );
});
