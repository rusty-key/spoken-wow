import { test } from "node:test";
import assert from "node:assert/strict";

import { decideImport, structuralDiff } from "./promote.mjs";

test("a line nobody has imported yet is promoted", () => {
  assert.deepEqual(decideImport(null, { text: "One." }), { action: "promote" });
});

test("identical text is not recorded at all", () => {
  assert.deepEqual(
    decideImport({ origin: "extracted", text: "One." }, { text: "One." }),
    { action: "skip" },
  );
});

test("new text over an extracted line is promoted", () => {
  assert.deepEqual(
    decideImport({ origin: "extracted", text: "One." }, { text: "Two." }),
    { action: "promote" },
  );
});

test("new text over an edited line is recorded but not promoted", () => {
  assert.deepEqual(
    decideImport({ origin: "edited", text: "One." }, { text: "Two." }),
    { action: "record" },
  );
});

test("identical text over an edited line is still nothing", () => {
  assert.deepEqual(
    decideImport({ origin: "edited", text: "One." }, { text: "One." }),
    { action: "skip" },
  );
});

test("structure that has moved is reported even when the text is identical", () => {
  const current = {
    origin: "extracted", text: "One.",
    bookId: 265, pageNumber: 1, pageCount: 1, title: "Deprecated TEST",
    ownerKind: "item", ownerIds: [3686], material: 1, generatable: true, skipReason: null,
  };
  const incoming = {
    text: "One.",
    bookId: 261, pageNumber: 4, pageCount: 4, title: "Town Registry",
    ownerKind: "item", ownerIds: [3657], material: 1, generatable: true, skipReason: null,
  };
  assert.deepEqual(structuralDiff(current, incoming), {
    bookId: 261, pageNumber: 4, pageCount: 4, title: "Town Registry", ownerIds: [3657],
  });
});

test("unmoved structure reports nothing", () => {
  const row = {
    origin: "extracted", text: "One.",
    bookId: 1, pageNumber: 1, pageCount: 1, title: "A Book",
    ownerKind: "item", ownerIds: [7], material: 1, generatable: true, skipReason: null,
  };
  assert.deepEqual(structuralDiff(row, { ...row }), {});
});

test("an edited line's structure still moves, because structure is the extract's business", () => {
  const current = {
    origin: "edited", text: "Corrected.",
    bookId: 1, pageNumber: 1, pageCount: 1, title: "Old Name",
    ownerKind: "item", ownerIds: [7], material: 1, generatable: true, skipReason: null,
  };
  const incoming = { ...current, text: "One.", title: "New Name" };
  assert.deepEqual(structuralDiff(current, incoming), { title: "New Name" });
});
