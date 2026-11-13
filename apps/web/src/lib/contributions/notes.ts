/**
 * The notes a contribution's written row carries, which is also how the row is found again. Kept
 * apart from accept.ts and correction.ts so store.ts can read them without importing either.
 */

/** The note a row accept wrote carries. */
export function noteFor(contributionId: number): string {
  return `contribution #${contributionId}`;
}

/** The note a correction's version carries, so its history says where the text came from. */
export function correctionNote(contributionId: number): string {
  return `correction from the game, contribution #${contributionId}`;
}

/** Every note a readables contribution's page may carry, accepted or corrected. */
export function pageNotes(contributionId: number): string[] {
  return [noteFor(contributionId), correctionNote(contributionId)];
}
