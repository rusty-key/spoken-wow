/**
 * A player's gender as the corrections tab weighs it: the reader a client showed a line to, and
 * the side of a `$G` each text is. Node-free, for the tab's client component.
 */
import type { UiText } from "@/lib/ui-text/en";

/** As quest_line's playerGender and readerGenders write it. */
export type ReaderGender = "m" | "f";

export function otherGender(gender: ReaderGender): ReaderGender {
  return gender === "f" ? "m" : "f";
}

export function isReaderGender(value: unknown): value is ReaderGender {
  return value === "m" || value === "f";
}

/** The reader's gender as this interface language names it: male, 男性, männlich. */
export function sexWord(t: UiText, gender: ReaderGender): string {
  return gender === "m" ? t.corrections.sex.male : t.corrections.sex.female;
}

/** Both sexes, joined the way this language joins two nouns. */
export function readingWord(t: UiText, genders: readonly ReaderGender[]): string {
  return genders.map((gender) => sexWord(t, gender)).join(t.corrections.andWord);
}
