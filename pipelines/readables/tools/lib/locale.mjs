// A language's pages and titles, as read out of the world database's *_locN columns.
//
// The English extract fixes which pages exist, in which books, owned by what; a language
// contributes only what each page says and what each owner is called. So a translated page
// is written only where an English page with that id exists, and nothing here decides a
// page's place in a book.

import { normaliseText, isGeneratable } from "./text.mjs";
import { lineIdFor } from "./naming.mjs";

/**
 * The translated pages among `rows`, one per page the English corpus carries.
 *
 * @param rows `{ entry, text }` from locales_page_text, text being Text_locN
 * @param englishLineIds the lineIds book_line holds in English
 */
export function localizedPages(rows, englishLineIds) {
  const pages = [];
  let withoutEnglish = 0;
  for (const row of rows) {
    // An empty column is no translation, whatever it looks like; nothing compares it with
    // the English, since a page that reads the same in two languages is still both.
    if (row.text === null || row.text === undefined || row.text.trim() === "") continue;
    const lineId = lineIdFor(row.entry);
    if (!englishLineIds.has(lineId)) {
      withoutEnglish++;
      continue;
    }
    const text = normaliseText(row.text);
    pages.push({ lineId, text, ...isGeneratable(text) });
  }
  return { pages, withoutEnglish };
}

/**
 * entity_name rows for the owners' names: `kind` as entity_name spells it, which says
 * 'gameobject' where book_line says 'object'.
 *
 * @param rows `{ kind: "object" | "item", id, name }`, name being name_locN
 */
export function localizedTitles(rows) {
  const titles = new Map();
  for (const row of rows) {
    if (!row.name || row.name.trim() === "") continue;
    const kind = row.kind === "object" ? "gameobject" : "item";
    const key = `${kind}:${row.id}`;
    if (!titles.has(key)) titles.set(key, { kind, entityId: String(row.id), name: row.name });
  }
  return [...titles.values()];
}
