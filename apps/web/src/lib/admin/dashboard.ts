/**
 * What is waiting in one language, for the admin dashboard: each count is read the way the page
 * that handles it reads it, so the number on the dashboard is the number that page opens on.
 *
 * Outdated audio is left out: whether a take is outdated is decided per take against every
 * pronunciation change (lib/generation/dirty.ts), which the explorers do one page at a time and
 * which over a whole language would cost more than the rest of this together.
 */
import "server-only";

import { listActivity } from "@/lib/activity/store";
import { pendingCounts, type PendingCounts } from "@/lib/contributions/pending";
import { missingAudioRanking } from "@/lib/contributions/missing-audio";
import { listGrants } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import type { Capability } from "@/lib/permissions";
import { pendingChanges } from "@/lib/releases/pending";
import { RELEASE_SECTIONS, type ReleaseSection } from "@/lib/releases/sections";
import { lastReleasedAt } from "@/lib/releases/store";
import { CATEGORIES, type Category, type Queue } from "@/lib/reports/reports";
import { listReports } from "@/lib/reports/store";
import { readAs } from "@/lib/teams/store";

import { keyOf, runsOf, type ActivityRun } from "./runs";

export type Dashboard = {
  release: { section: ReleaseSection; count: number; restored: number; since: string | null }[];
  contributions: PendingCounts;
  reports: Record<Category, number>;
  /** Of the most-heard silent lines the Missing audio page ranks, those with no take at all. */
  missing: { count: number; ranked: number; top: { lineId: string; text: string | null; installs: number } | null };
  /** Who holds each capability in the language, by name. */
  holders: Record<Capability, string[]>;
  week: { takes: number; accepted: number; releases: number };
  recent: ActivityRun[];
};

/**
 * How many rows the recent list folds into runs: enough that an afternoon of takes cut one by
 * one counts in full, read newest first on the activity index.
 */
const RECENT_ROWS = 2_000;
const RECENT_RUNS = 6;

const WEEK = `now() - interval '7 days'`;

/** `queues` are the report queues the viewer triages, as /reports lists them for the same viewer. */
export async function dashboard(lang: Lang, queues: readonly Queue[]): Promise<Dashboard> {
  const [released, contributions, reports, ranking, grants, week, recent] = await Promise.all([
    lastReleasedAt(lang),
    pendingCounts(lang),
    queues.length > 0 ? listReports("open", "all", "all", null, lang, queues) : Promise.resolve([]),
    missingAudioRanking(lang),
    listGrants([lang]),
    weekIn(lang),
    listActivity({ lang, limit: RECENT_ROWS }),
  ]);

  const release = await Promise.all(
    RELEASE_SECTIONS.map(async (section) => {
      const since = released.get(section) ?? null;
      const pending = await pendingChanges(section, lang, since, { list: false });
      return {
        section,
        count: pending.count + pending.textChanges,
        restored: pending.restored,
        since: pending.since,
      };
    }),
  );

  const byCategory = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>;
  for (const report of reports) byCategory[report.category]++;

  const silent = ranking.filter((row) => !row.voiced);
  const holders = {} as Record<Capability, string[]>;
  for (const grant of grants) (holders[grant.capability] ??= []).push(grant.name || grant.email);

  return {
    release,
    contributions,
    reports: byCategory,
    missing: {
      count: silent.length,
      ranked: ranking.length,
      top: silent[0] ? { lineId: silent[0].lineId, text: silent[0].text, installs: silent[0].installs } : null,
    },
    holders,
    week,
    recent: recentRuns(recent.rows, recent.next !== null),
  };
}

/** The last seven days of the activity log, in the three numbers a team cares about. */
async function weekIn(lang: Lang): Promise<Dashboard["week"]> {
  const rows = await readAs<{ takes: string; accepted: string; releases: string }>(
    lang,
    `select count(*) filter (where "kind" = 'take.generated') as "takes",
            count(*) filter (where "kind" = 'contribution.resolved' and "detail"->>'status' = 'accepted') as "accepted",
            count(*) filter (where "kind" = 'release.finished' and "detail"->>'state' = 'done') as "releases"
       from "activity" where "lang" = $1 and "at" > ${WEEK}`,
    [lang],
  );
  const row = rows[0];
  return { takes: Number(row?.takes ?? 0), accepted: Number(row?.accepted ?? 0), releases: Number(row?.releases ?? 0) };
}

function recentRuns(rows: Parameters<typeof runsOf>[0], more: boolean): ActivityRun[] {
  const runs = runsOf(rows, RECENT_RUNS);
  // A run the read ended inside may go on past it: the one holding the last row read.
  const end = rows.at(-1);
  if (more && end) {
    for (const run of runs) if (run.from === end.at && keyOf(run.row) === keyOf(end)) run.atLeast = true;
  }
  return runs;
}
