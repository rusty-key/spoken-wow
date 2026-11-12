/**
 * The lexicon over /api/v1: entries in, entries out, keyed by grapheme.
 *
 * A write replaces or adds whole entries and leaves the rest of the lexicon alone. An entry is
 * replaced whole, so a note left out of an update is dropped. Matching ignores case, as the
 * rules do, and the grapheme sent becomes the stored spelling.
 */
import { ruleKey as keyOf, type LexiconEntry } from "@/lib/generation/lexicon";

export type EntryStatus = "created" | "updated" | "unchanged";

export type EntryResult = { grapheme: string; status: EntryStatus };

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
 * The lexicon with `incoming` written into it: replaced in place, or appended when new. When
 * nothing changes it is `current` itself, which editLexicon reads as nothing to write.
 */
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

  const changed = result.some((r) => r.status !== "unchanged");
  return { entries: changed ? entries : current, result };
}

export function findEntry(entries: LexiconEntry[], grapheme: string): LexiconEntry | undefined {
  return entries.find((entry) => keyOf(entry.grapheme) === keyOf(grapheme));
}
