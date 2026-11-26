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

export type ReviewStatus = "good" | "needs-work";

/** "none": no design yet; "pending": designed, nobody has given a verdict. */
export type Doneness = "none" | "pending" | ReviewStatus;

export const DONENESS: readonly Doneness[] = ["none", "pending", "needs-work", "good"];

/** The newest verdict on the newest version; `reviews` oldest first. */
export function donenessOf(latest: { reviews: readonly { status: ReviewStatus }[] } | null): Doneness {
  if (!latest) return "none";
  return latest.reviews.at(-1)?.status ?? "pending";
}
