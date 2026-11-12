/**
 * The lexicon over /api/v1: entries in, entries out, keyed by grapheme.
 *
 * A write replaces or adds whole entries and leaves the rest of the lexicon alone. An entry is
 * replaced whole, so a note left out of an update is dropped. Matching ignores case, as the
 * rules do, and the grapheme sent becomes the stored spelling.
 */
import { LexiconError, validateEntry, type LexiconEntry } from "@/lib/generation/lexicon";

export type EntryStatus = "created" | "updated" | "unchanged";

export type EntryResult = { grapheme: string; status: EntryStatus };

const keyOf = (grapheme: string) => grapheme.toLowerCase();

function sameEntry(a: LexiconEntry, b: LexiconEntry): boolean {
  return (
    a.grapheme === b.grapheme &&
    a.ipa === b.ipa &&
    a.alias === b.alias &&
    a.confidence === b.confidence &&
    a.note === b.note
  );
}

/**
 * Check every item, or throw LexiconError naming the first bad one. The same grapheme twice is
 * refused: one of the two would be silently lost.
 */
export function validateItems(items: unknown[]): LexiconEntry[] {
  const entries = items.map(validateEntry);
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const first = seen.get(keyOf(entry.grapheme));
    if (first !== undefined) {
      throw new LexiconError(`entry ${index}: "${entry.grapheme}" repeats entry ${first}; matching ignores case`);
    }
    seen.set(keyOf(entry.grapheme), index);
  });
  return entries;
}

/** The lexicon with `incoming` written into it: replaced in place, or appended when new. */
export function upsertEntries(
  current: LexiconEntry[],
  incoming: LexiconEntry[],
): { entries: LexiconEntry[]; result: EntryResult[] } {
  const entries = [...current];
  const at = new Map(entries.map((entry, index) => [keyOf(entry.grapheme), index]));

  const result = incoming.map((entry): EntryResult => {
    const index = at.get(keyOf(entry.grapheme));
    if (index === undefined) {
      at.set(keyOf(entry.grapheme), entries.length);
      entries.push(entry);
      return { grapheme: entry.grapheme, status: "created" };
    }
    if (sameEntry(entries[index], entry)) return { grapheme: entry.grapheme, status: "unchanged" };
    entries[index] = entry;
    return { grapheme: entry.grapheme, status: "updated" };
  });

  return { entries, result };
}

export function findEntry(entries: LexiconEntry[], grapheme: string): LexiconEntry | undefined {
  return entries.find((entry) => keyOf(entry.grapheme) === keyOf(grapheme));
}
