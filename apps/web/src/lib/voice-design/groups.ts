/**
 * How the workbench arranges slots: by race-gender, the unit Gemini compares blind, and by how
 * far each slot's newest design has got.
 */

/** `orc-male-shady` → `orc-male`. A bare race-gender slot is its own group. */
export function groupOf(slot: string): string {
  return slot.split("-").slice(0, 2).join("-");
}

export function flavorOf(slot: string): string | null {
  const parts = slot.split("-");
  return parts.length > 2 ? parts.slice(2).join("-") : null;
}

/**
 * The versions a slot's page shows, newest first: the newest, which the next one replaces, and
 * the one players hear while it is an older one, so its votes stay beside the filter that reads them.
 */
export function onPage<D extends { isPublic: boolean }>(designs: readonly D[]): D[] {
  const [newest, ...older] = designs;
  if (!newest) return [];
  const heard = newest.isPublic ? undefined : older.find((design) => design.isPublic);
  return heard ? [newest, heard] : [newest];
}

export type ReviewStatus = "good" | "needs-work";

/** "none": no design yet; "pending": designed, nobody has given a verdict. */
export type Doneness = "none" | "pending" | ReviewStatus;

export const DONENESS: readonly Doneness[] = ["none", "pending", "needs-work", "good"];

/**
 * Whether Revise from review applies: needs work, or not reviewed yet (a sibling's notes may
 * already say what to change), and Gemini has a sample line to listen to.
 */
export function isRevisable(design: { reviews: readonly { status: ReviewStatus }[]; samples: readonly unknown[] }): boolean {
  return design.reviews.at(-1)?.status !== "good" && design.samples.length > 0;
}

/** The newest verdict on the newest version; `reviews` oldest first. */
export function donenessOf(latest: { reviews: readonly { status: ReviewStatus }[] } | null): Doneness {
  if (!latest) return "none";
  return latest.reviews.at(-1)?.status ?? "pending";
}

/** What players make of a slot: by majority of the answers given, so a few votes count like many. */
export type PlayersSay = "fits" | "mixed" | "off" | "no-votes";

export const PLAYERS_SAY: readonly PlayersSay[] = ["off", "mixed", "fits", "no-votes"];

/**
 * The round players vote in now: the public version's newest showing. Skips are no opinion, so
 * they count for nothing; null when players hear none of the slot's versions.
 */
export function playersSay(
  designs: readonly { isPublic: boolean; showings: readonly { counts: Record<"fits" | "close" | "off" | "skip", number> }[] }[],
): PlayersSay | null {
  const round = designs.find((design) => design.isPublic)?.showings[0];
  if (!round) return null;
  const { fits, close, off } = round.counts;
  const answered = fits + close + off;
  if (answered === 0) return "no-votes";
  if (fits * 2 > answered) return "fits";
  if (off * 2 > answered) return "off";
  return "mixed";
}
