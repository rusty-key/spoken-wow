// What a re-import does to a line that already exists: the rule is shared by every
// pipeline's importer and lives in pipelines/lib/promote.mjs. What is only the readables
// import's business -- a page's place in a book -- is below.
export { decideImport } from "../../../lib/promote.mjs";

/**
 * The structural fields the extract has moved, whatever the text says.
 *
 * Text and structure are versioned differently on purpose. Text is content: a new version
 * is recorded so the history shows it, and an edit outranks the dump. Structure is a fact
 * about the world -- which book a page belongs to, what number it is, what the object is
 * called -- and 0026 says plainly that it is the extract's business and not an editor's.
 * So structure is corrected in place on the live row, on edited lines too.
 *
 * Without this, a page could only be re-placed by changing its text as well. One page moved
 * between books the first time this ran, when a deprecated test item stopped claiming page
 * 265 of the Hillsbrad Town Registry, and its text never changed at all.
 */
const STRUCTURAL = ["bookId", "pageNumber", "pageCount", "title", "ownerKind", "material", "generatable", "skipReason"];

export function structuralDiff(current, incoming) {
  const diff = {};
  for (const field of STRUCTURAL) {
    if (current[field] !== incoming[field]) diff[field] = incoming[field];
  }
  // An array, so compared by value rather than by reference like the rest.
  const ids = current.ownerIds ?? [];
  const next = incoming.ownerIds ?? [];
  if (ids.length !== next.length || ids.some((id, index) => id !== next[index])) {
    diff.ownerIds = next;
  }
  return diff;
}
