/**
 * A player's gender as the corrections tab weighs it: the reader a client showed a line to, and
 * the side of a `$G` each text is. Node-free, for the tab's client component.
 */

/** As quest_line's playerGender and readerGenders write it. */
export type ReaderGender = "m" | "f";

export const GENDER_NAMES: Record<ReaderGender, string> = { m: "male", f: "female" };

export function otherGender(gender: ReaderGender): ReaderGender {
  return gender === "f" ? "m" : "f";
}

export function isReaderGender(value: unknown): value is ReaderGender {
  return value === "m" || value === "f";
}
