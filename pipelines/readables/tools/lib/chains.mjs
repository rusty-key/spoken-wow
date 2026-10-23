// page_text rows are a linked list; a book is what you get by walking it.
//
// Pure on purpose. The MySQL reader hands over two flat arrays, and everything deciding
// what a book IS happens here, where it can be tested without a dump -- the dump is
// hundreds of megabytes, and downloading it to find out whether page numbering is right
// is not a test cycle anybody runs twice.

import { lineIdFor, fileFor, pageChecksum, textHash } from "./naming.mjs";
import { normaliseText, spokenText, isGeneratable } from "./text.mjs";

/**
 * Every voiceable page, plus the pages nothing in the world can open.
 *
 * Orphans are counted rather than dropped silently: vmangos carries page text for content
 * that was cut, and a number that moves between dumps is the signal that the extract's
 * owner queries have gone wrong -- which would otherwise look merely like a quieter corpus.
 *
 * `shared` holds pages a second book's chain runs into. One page is one line id, so a page
 * can belong to one book only, and the alternative -- emitting it once per chain -- puts
 * two rows with the same lineId in an import that then has to pick one. vmangos has one
 * such page today: 265 is page 4 of the Hillsbrad Town Registry, and a deprecated test
 * item starts its chain there.
 */
export function buildBooks({ pages, owners }) {
  const byEntry = new Map(pages.map((page) => [page.entry, page]));

  // Several objects can open one chain, so owners collapse per first page rather than the
  // chain being claimed by whichever row happened to be read last.
  const ownersByFirstPage = new Map();
  for (const owner of owners) {
    const existing = ownersByFirstPage.get(owner.firstPage);
    if (existing) {
      existing.ids.push(owner.id);
      continue;
    }
    ownersByFirstPage.set(owner.firstPage, {
      kind: owner.kind,
      ids: [owner.id],
      name: owner.name,
      material: owner.material,
    });
  }

  const entries = [];
  const reached = new Set();
  const emitted = new Set();
  const shared = [];

  // Sorted, so which book keeps a shared page is a property of the data rather than of the
  // order MySQL happened to return the owners in. Two dumps with the same rows must produce
  // the same corpus, or the diff that reviews an extract is worthless.
  const chains = [...ownersByFirstPage.entries()].sort(([a], [b]) => a - b);

  for (const [firstPage, owner] of chains) {
    const chain = walk(firstPage, byEntry);
    for (const page of chain) reached.add(page.entry);

    const ownerIds = [...owner.ids].sort((a, b) => a - b);
    const pages = chain.filter((page) => {
      if (!emitted.has(page.entry)) return true;
      shared.push(page.entry);
      return false;
    });

    pages.forEach((page, index) => {
      emitted.add(page.entry);
      const text = normaliseText(page.text);
      const { generatable, skipReason } = isGeneratable(text);
      entries.push({
        lineId: lineIdFor(page.entry),
        pageId: page.entry,
        bookId: firstPage,
        pageNumber: index + 1,
        pageCount: pages.length,
        title: owner.name,
        ownerKind: owner.kind,
        ownerIds,
        material: owner.material,
        text,
        spoken: spokenText(text),
        checksum: pageChecksum(text),
        hash: textHash(text),
        file: fileFor(page.entry),
        generatable,
        skipReason,
      });
    });
  }

  const orphans = pages.map((page) => page.entry).filter((entry) => !reached.has(entry));
  return { entries, orphans, shared };
}

/**
 * The pages of one book, in reading order.
 *
 * `seen` is not defensive habit: a next_page loop in a dump would hang the extract with no
 * output and no error, which is the worst way to learn a dump has one.
 */
export function walk(firstPage, byEntry) {
  const chain = [];
  const seen = new Set();
  let entry = firstPage;
  while (entry && byEntry.has(entry) && !seen.has(entry)) {
    seen.add(entry);
    const page = byEntry.get(entry);
    chain.push(page);
    entry = page.nextPage;
  }
  return chain;
}
