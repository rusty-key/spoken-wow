/**
 * The dashboard's recent activity as runs: one person doing one kind of thing in one section,
 * row after row, is one line, however many rows it was. Browser-safe.
 *
 * Without it a single afternoon of cutting takes one by one fills the list with the same row
 * and hides everything else that happened.
 */
import type { ActivityRow } from "@/lib/activity/store";

/** A pause longer than this starts a new run, even for the same person doing the same thing. */
export const RUN_GAP_MS = 30 * 60_000;

export type ActivityRun = {
  /** The newest row of the run: what a run of one shows as it is. */
  row: ActivityRow;
  count: number;
  /** ISO: the oldest row's time. Equal to row.at for a run of one. */
  from: string;
  /** The rows read ran out inside this run, so it holds at least `count`. */
  atLeast?: boolean;
};

/**
 * What a run of each foldable kind counts, as the dashboard words it ("generated 1,400 takes").
 * Only acts done many times over to many lines: a run of grants or settings would merge
 * different people and choices into one row that says neither, so those never fold.
 */
export const FOLDABLE: Partial<Record<ActivityRow["kind"], string>> = {
  "take.generated": "generated {n} takes",
  "take.restored": "restored {n} older takes",
  "take.acked": "marked {n} takes fine after a pronunciation change",
  "recording.uploaded": "recorded {n} lines",
  "contribution.resolved": "resolved {n} contributions",
  "text.edited": "edited {n} texts",
  "name.edited": "renamed {n} lines",
  "ignore.set": "ignored {n} lines",
  "ignore.cleared": "stopped ignoring {n} lines",
  "override.set": "set what {n} lines say",
  "lexicon.added": "added {n} pronunciations",
  "lexicon.edited": "changed {n} pronunciations",
};

export const keyOf = (row: ActivityRow) =>
  row.kind in FOLDABLE ? `${row.actorId ?? ""}|${row.kind}|${row.source ?? ""}` : `row:${row.id}`;

/**
 * `rows` newest first, as listActivity gives them; the first `max` runs, newest first.
 *
 * A row joins its person's run while that run is still going, whatever came between: two people
 * cutting takes in the same hour interleave row by row, and each still did one thing.
 */
export function runsOf(rows: readonly ActivityRow[], max: number, gapMs = RUN_GAP_MS): ActivityRun[] {
  const runs: ActivityRun[] = [];
  const open = new Map<string, ActivityRun>();
  for (const row of rows) {
    const key = keyOf(row);
    const run = open.get(key);
    if (run && Date.parse(run.from) - Date.parse(row.at) <= gapMs) {
      run.count++;
      run.from = row.at;
      continue;
    }
    const started = { row, count: 1, from: row.at };
    runs.push(started);
    open.set(key, started);
  }
  return runs.slice(0, max);
}
