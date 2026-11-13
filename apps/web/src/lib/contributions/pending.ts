/**
 * How many rows wait in each tab of /contributions, for the counts on the tabs themselves.
 *
 * Counted as the tab's link lands: new rows, under the default client filter, before any stage
 * or search. A Quests or Readables count is both its views, Contributions and Corrections together.
 */
import "server-only";

import { clientFilterOf, clientOf, matchesClient } from "./client";
import type { ContributionStatus } from "./contributions";
import { lineStates, tabOf, type LineState } from "./known";
import type { ContributionSort, Section } from "./query";
import { listContributions, type Contribution } from "./store";

export type PendingCounts = {
  sections: Record<Section, number>;
  quests: ViewCounts;
  readables: ViewCounts;
};

type ViewCounts = { contributions: number; corrections: number };

type StatedRows = { rows: Contribution[]; states: LineState[] };

function countsOf({ rows, states }: StatedRows): PendingCounts {
  const client = clientFilterOf(undefined);
  const counts: PendingCounts = {
    sections: { quests: 0, readables: 0, places: 0 },
    quests: { contributions: 0, corrections: 0 },
    readables: { contributions: 0, corrections: 0 },
  };
  rows.forEach((row, index) => {
    if (!matchesClient(clientOf(row.build).family, client)) return;
    const tab = tabOf(row.status, states[index]);
    if (tab === null) return;
    // Only quests and readables have text a correction can disagree with.
    const viewed = row.source === "quests" || row.source === "readables";
    if (tab === "corrections" && !viewed) return;
    counts.sections[row.source]++;
    if (row.source === "quests" || row.source === "readables") counts[row.source][tab]++;
  });
  return counts;
}

async function newRows(lang: string, sort?: ContributionSort): Promise<StatedRows> {
  const rows = await listContributions("new", lang, sort);
  return { rows, states: await lineStates(rows) };
}

export async function pendingCounts(lang: string): Promise<PendingCounts> {
  return countsOf(await newRows(lang));
}

/**
 * One section's rows of a status with their line states, and the tab counts.
 *
 * On the new tab the counts read the same rows, in every section, so both come from one list:
 * lineStates costs a query per kind of row, and a queue in the thousands paid for it twice.
 */
export async function listedWithPending(
  status: ContributionStatus,
  lang: string,
  sort: ContributionSort | undefined,
  source: Section,
): Promise<{ listed: Contribution[]; states: LineState[]; pending: PendingCounts }> {
  if (status === "new") {
    const all = await newRows(lang, sort);
    const inSection = all.rows.flatMap((row, index) => (row.source === source ? [{ row, state: all.states[index] }] : []));
    return {
      listed: inSection.map(({ row }) => row),
      states: inSection.map(({ state }) => state),
      pending: countsOf(all),
    };
  }
  const [listed, pending] = await Promise.all([listContributions(status, lang, sort, source), pendingCounts(lang)]);
  return { listed, states: await lineStates(listed), pending };
}
