// The vmangos world database, read once.
//
// PATCH IS NOT OPTIONAL. gameobject_template and item_template hold a row per content
// patch, and the server serves max(patch) <= the patch it runs (vmangos ObjectMgr.cpp:8143
// and :3820). Selected without it, an object comes back under several names at once and
// the extract emits a book titled whatever it was called in 1.2.
//
// page_text has no patch column, which is why it is selected plainly below -- a difference
// worth seeing in the SQL rather than assuming in either direction.

import { walk } from "./chains.mjs";

/** The patch a 1.12 server serves. Matches tts_cli/sql_queries.py's default. */
export const PATCH = 10;

/** GAMEOBJECT_TYPE_TEXT. data0 is the first page_text entry. */
const GO_TYPE_TEXT = 9;
/**
 * GAMEOBJECT_TYPE_GOOBER. data7 is the page it opens when used: the Ameth'Aran tablets in
 * Darkshore are goobers, and a reader reading only type 9 never saw them.
 */
const GO_TYPE_GOOBER = 10;

export async function readWorld(connection, patch = PATCH) {
  const [pageRows] = await connection.query(
    "SELECT `entry`, `text`, `next_page` FROM `page_text`",
  );

  const [objectRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name,
            IF(t1.type = ?, t1.data0, t1.data7) AS firstPage
       FROM gameobject_template t1
      WHERE ((t1.type = ? AND t1.data0 > 0) OR (t1.type = ? AND t1.data7 > 0))
        AND t1.patch = (SELECT MAX(t2.patch) FROM gameobject_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [GO_TYPE_TEXT, GO_TYPE_TEXT, GO_TYPE_GOOBER, patch],
  );

  const [itemRows] = await connection.query(
    `SELECT t1.entry AS id, t1.name AS name, t1.page_text AS firstPage,
            t1.page_material AS material
       FROM item_template t1
      WHERE t1.page_text > 0
        AND t1.patch = (SELECT MAX(t2.patch) FROM item_template t2
                         WHERE t2.entry = t1.entry AND t2.patch <= ?)`,
    [patch],
  );

  return {
    pages: pageRows.map((row) => ({
      entry: row.entry,
      text: row.text,
      nextPage: row.next_page,
    })),
    owners: [
      // A GameObject's material is chosen by its display, not carried on the template, so
      // object books record 0 and the site reads that as parchment.
      ...objectRows.map((row) => ({
        kind: "object",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: 0,
      })),
      ...itemRows.map((row) => ({
        kind: "item",
        id: row.id,
        name: row.name,
        firstPage: row.firstPage,
        material: row.material,
      })),
    ],
  };
}

// Forever's own readables, which vmangos has no page of. Named one by one rather than found:
// the repack also holds hundreds of retail page chains (K'aresh, Siren Isle) that Forever
// never shows, and the corpus is Classic-era only.
//
// The Zephras Isle objects (map 2991). 658836 and 658840-1 show pages the repack has no text
// for, so they add nothing until it does.
export const FOREVER_OBJECTS = [
  617704, // Bloody Note
  658836, // On the Shal'nan
  658837, // The Shal'nan's Abdication
  658838, 658839, 658840, 658841, // The Rebellion In Eldre'Thalas, Parts 1-4
  671478, // The Sky-Touched Mystery
  671479, // On The Windlord
];
// Items, whose pages come from Forever's client (the repack has no item table). Advisor
// Nazgrel hands his Instructions to an elf guest in Grommash Hold. The Bloody Note item is
// left out: it opens object 617704's pages, and a chain has one kind of owner.
export const FOREVER_ITEMS = [285357];

/**
 * The FOREVER_OBJECTS and the given item owners, with every page they reach, from the Forever
 * repack: TrinityCore's schema, so no patch column and the columns are named differently.
 */
export async function readForever(connection, items = [], objects = FOREVER_OBJECTS) {
  const [objectRows] = await connection.query(
    `SELECT entry AS id, name, IF(type = ?, Data0, Data7) AS firstPage
       FROM gameobject_template
      WHERE entry IN (?) AND type IN (?, ?)`,
    [GO_TYPE_TEXT, objects, GO_TYPE_TEXT, GO_TYPE_GOOBER],
  );
  const found = new Set(objectRows.map((row) => Number(row.id)));
  const lost = objects.filter((id) => !found.has(id));
  if (lost.length) throw new Error(`no page-showing object ${lost.join(", ")} in the Forever repack`);

  const [pageRows] = await connection.query(
    "SELECT ID AS entry, Text AS text, NextPageID AS nextPage FROM page_text",
  );

  const owners = [
    ...objectRows.map((row) => ({
      kind: "object",
      id: Number(row.id),
      name: row.name,
      firstPage: Number(row.firstPage),
      material: 0,
    })),
    ...items,
  ];
  const byEntry = new Map(pageRows.map((row) => [
    Number(row.entry),
    { entry: Number(row.entry), text: row.text, nextPage: Number(row.nextPage) },
  ]));
  const pages = new Map();
  for (const owner of owners) {
    for (const page of walk(owner.firstPage, byEntry)) pages.set(page.entry, page);
  }
  return { pages: [...pages.values()], owners };
}

/**
 * vmangos's world with Forever's readables added. A Forever page with a vmangos page's id is
 * refused: one id would then name two texts, and b:{pageTextID} is frozen.
 */
export function withForever(world, forever) {
  const known = new Set(world.pages.map((page) => page.entry));
  const clash = forever.pages.filter((page) => known.has(page.entry)).map((page) => page.entry);
  if (clash.length) {
    throw new Error(`Forever pages ${clash.join(", ")} are vmangos pages too`);
  }
  return {
    pages: [...world.pages, ...forever.pages],
    owners: [...world.owners, ...forever.owners],
  };
}
