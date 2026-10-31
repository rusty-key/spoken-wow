import { test } from "node:test";
import assert from "node:assert/strict";

import { booksLua, indexLua, pageIndex, quote } from "./lua.mjs";
import { pageChecksum } from "./naming.mjs";

const entries = [
  { pageId: 10, bookId: 10, pageNumber: 1, pageCount: 2, title: "A Dusty Tome", text: "One." },
  { pageId: 11, bookId: 10, pageNumber: 2, pageCount: 2, title: "A Dusty Tome", text: "Two." },
  { pageId: 20, bookId: 20, pageNumber: 1, pageCount: 1, title: "A Note", text: "Three." },
];

test("the header says the file is generated", () => {
  assert.match(booksLua(entries), /AUTO-GENERATED[\s\S]*Do not edit by hand/);
});

test("a page is indexed by title, number and checksum", () => {
  const lua = booksLua(entries);
  assert.ok(lua.includes(`["A Dusty Tome"]`));
  assert.ok(lua.includes(`[${pageChecksum("One.")}] = 10`));
});

test("a page records which book it belongs to and where", () => {
  assert.match(booksLua(entries), /\[11\] = \{ book = 10, number = 2, text = "Two\." \}/);
});

test("captions retain page breaks without changing the reader's checksum", () => {
  const text = '<HTML><BODY><H1>Ledger</H1>Three crates.$B"Paid"</BODY></HTML>';
  const lua = booksLua([{ ...entries[0], text }]);
  assert.ok(lua.includes(`text = ${quote('Ledger\nThree crates.\n"Paid"')}`));
  assert.ok(lua.includes(`[${pageChecksum(text)}] = 10`));
});

test("Lua strings preserve UTF-8 and escape quotes, backslashes and control bytes", () => {
  assert.equal(quote('Été\\"\n\t\r\u00002'), '"Été\\\\\\"\\010\\009\\013\\0002"');
});

test("a book lists its pages in reading order", () => {
  assert.match(booksLua(entries), /\[10\] = \{ title = "A Dusty Tome", pages = \{ 10, 11 \} \}/);
});

test("a unique checksum is reachable without the title", () => {
  assert.match(booksLua(entries), new RegExp(`\\[${pageChecksum("Three.")}\\] = 20`));
});

test("a checksum shared by two pages is left out of the loose index", () => {
  // Reachable by title and page number, never by checksum alone: a fallback that can
  // return the wrong page reads the wrong words aloud, which is worse than staying quiet.
  const shared = [
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 1, title: "Ledger", text: "..." },
    { pageId: 2, bookId: 2, pageNumber: 1, pageCount: 1, title: "Tally", text: "..." },
  ];
  const lua = booksLua(shared);
  const loose = lua.slice(lua.indexOf("loose = {"), lua.indexOf("pages = {"));
  assert.ok(!loose.includes(String(pageChecksum("..."))), "the ambiguous checksum is absent");
});

test("a book nobody can have is left out with its pages", () => {
  const lua = booksLua([
    ...entries,
    { pageId: 30, bookId: 30, pageNumber: 1, pageCount: 1, title: "Deprecated Writ of Lakeshire", text: "Writ." },
    { pageId: 40, bookId: 40, pageNumber: 1, pageCount: 1, title: "Sam's Tome", text: "Missing Text" },
    { pageId: 691, bookId: 691, pageNumber: 1, pageCount: 1, title: "Musty Note", text: "Brother." },
  ]);
  assert.doesNotMatch(lua, /Deprecated|Sam's Tome|Musty Note|\[(30|40|691)\] = \{ book/);
  assert.match(lua, /\[20\] = \{ title = "A Note"/);
});

test("a quote in a title is escaped", () => {
  const lua = booksLua([
    { pageId: 1, bookId: 1, pageNumber: 1, pageCount: 1, title: 'The "Book"', text: "x" },
  ]);
  assert.ok(lua.includes('["The \\"Book\\""]'));
});

test("the output is sorted, so a re-export diffs only where the corpus moved", () => {
  const shuffled = [entries[2], entries[1], entries[0]];
  assert.equal(booksLua(shuffled), booksLua(entries));
});

test("pages that are indistinguishable on screen resolve to the lowest book, deterministically", () => {
  // "Inscribed Kodo Leather" is four different books holding identical text. Nothing on
  // screen tells them apart -- same title, same page number, same words -- so the addon
  // cannot either, and the narration is the same whichever it picks. What matters is that
  // it picks the same one every time rather than whichever row was written last.
  const identical = [
    { pageId: 40, bookId: 40, pageNumber: 1, pageCount: 1, title: "Inscribed Kodo Leather", text: "Same." },
    { pageId: 30, bookId: 30, pageNumber: 1, pageCount: 1, title: "Inscribed Kodo Leather", text: "Same." },
  ];
  const lua = booksLua(identical);
  assert.match(lua, new RegExp(`\\[1\\] = \\{ \\[${pageChecksum("Same.")}\\] = 30 \\}`));
});

test("a page is found under each of its texts", () => {
  const { index } = pageIndex([
    { pageId: 38, bookId: 38, pageNumber: 1, titles: ["Nota de Wiley"], texts: ["Stoutmantle --", "Mantorrecio:"] },
  ]);
  const byChecksum = index.get("Nota de Wiley").get(1);
  assert.equal(byChecksum.get(pageChecksum("Stoutmantle --")), 38);
  assert.equal(byChecksum.get(pageChecksum("Mantorrecio:")), 38);
});

test("a minted page is written as a quoted key", () => {
  const lines = indexLua(pageIndex([{ pageId: "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", bookId: "n1", pageNumber: 1, title: "X", text: "Y" }]), "extra");
  assert.ok(lines.some((line) => line.includes('= "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"')));
  assert.equal(lines[0], "\textraIndex = {");
});

test("an item or object names the book it opens", () => {
  const lua = booksLua([
    { ...entries[0], ownerKind: "item", ownerIds: [2794] },
    { ...entries[1], ownerKind: "item", ownerIds: [2794] },
    { ...entries[2], ownerKind: "object", ownerIds: [175732, 175733] },
  ]);
  assert.match(lua, /item = \{\n\t\t\t\[2794\] = 10,\n\t\t\}/);
  assert.match(lua, /object = \{\n\t\t\t\[175732\] = 20,\n\t\t\t\[175733\] = 20,\n\t\t\}/);
});

test("an id that opens two books names neither", () => {
  const lua = booksLua([
    { ...entries[0], ownerKind: "object", ownerIds: [1] },
    { ...entries[2], ownerKind: "object", ownerIds: [1, 2] },
  ]);
  assert.match(lua, /object = \{\n\t\t\t\[2\] = 20,\n\t\t\}/);
});
