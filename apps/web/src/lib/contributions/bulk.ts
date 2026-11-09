/**
 * Why a ticked row is left out of "Accept selected".
 *
 * Node-free, because ContributionTable is a client component. `bulk` comes from the server, since
 * book-match.ts reads the database and cannot be imported here.
 */
import type { BookMatchResult } from "./book-match";
import type { ContributionStatus } from "./contributions";
import type { Bucket } from "./query";

export type BulkHold = "accepted" | "speaker" | "ambiguous" | "known" | "correction" | "new-book";

export function bulkHold(row: {
  status: ContributionStatus;
  bucket: Bucket;
  bulk: boolean;
  matchKind: BookMatchResult["kind"] | undefined;
}): BulkHold | null {
  if (row.status === "accepted") return "accepted";
  if (row.bucket !== "ready") return "speaker";
  if (row.bulk) return null;
  if (row.matchKind === "ambiguous" || row.matchKind === "known" || row.matchKind === "correction") return row.matchKind;
  return "new-book";
}

const HOLD_WORDS: Record<BulkHold, string> = {
  accepted: "already accepted",
  speaker: "no speaker yet",
  ambiguous: "no page picked",
  known: "already in the corpus",
  correction: "on the Corrections tab",
  "new-book": "new book, accept on its own",
};

/** The reasons in one line, or null when nothing is left out. */
export function bulkHoldSummary(holds: readonly (BulkHold | null)[]): string | null {
  const counts = new Map<BulkHold, number>();
  for (const hold of holds) if (hold) counts.set(hold, (counts.get(hold) ?? 0) + 1);
  if (counts.size === 0) return null;
  return `Left out: ${[...counts].map(([hold, count]) => `${count} ${HOLD_WORDS[hold]}`).join(", ")}`;
}
