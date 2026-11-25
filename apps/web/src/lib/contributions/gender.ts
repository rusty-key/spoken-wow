/**
 * A player's gender as the corrections tab weighs it: the reader a client showed a line to, and
 * the side of a `$G` each text is. Node-free, for the tab's client component.
 */
import { fill } from "@/lib/site-text/format";
import type { UiText } from "@/lib/ui-text/en";

/** As quest_line's playerGender and readerGenders write it. */
export type ReaderGender = "m" | "f";

export function otherGender(gender: ReaderGender): ReaderGender {
  return gender === "f" ? "m" : "f";
}

export function isReaderGender(value: unknown): value is ReaderGender {
  return value === "m" || value === "f";
}

export function sexWord(t: UiText, gender: ReaderGender): string {
  return gender === "m" ? t.reports.landing.facts.sex.male : t.reports.landing.facts.sex.female;
}

export function readingWord(t: UiText, genders: readonly ReaderGender[]): string {
  const [head, tail] = genders.map((gender) => sexWord(t, gender));
  return tail === undefined ? head : fill(t.teams.listJoin, { head, tail });
}
