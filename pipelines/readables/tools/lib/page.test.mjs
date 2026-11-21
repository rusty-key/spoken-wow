import { test } from "node:test";
import assert from "node:assert/strict";

import { bookPageUpsert } from "./page.mjs";

test("an extracted page is written under its own id, its book as text", () => {
  const { text, values } = bookPageUpsert({
    lineId: "b:1381", pageId: 1381, bookId: 1380, pageNumber: 2,
    ownerKind: "item", ownerIds: [5], material: 1,
  });
  assert.match(text, /insert into "book_page"/);
  assert.match(text, /on conflict \("lineId"\) do update/);
  assert.deepEqual(values, ["b:1381", 1381, "1380", 2, "item", [5], 1]);
});
