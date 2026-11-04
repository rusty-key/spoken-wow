/**
 * What is waiting in one language, for the admin dashboard: each count is read the way the page
 * that handles it reads it, so the number on the dashboard is the number that page opens on.
 *
 * Outdated audio is left out: whether a take is outdated is decided per take against every
 * pronunciation change, which the explorers do one page at a time and which over a whole
 * language would cost more than the rest of this together.
 */
import "server-only";

import { listActivity } from "@/lib/activity/store";
import { pendingCounts, type PendingCounts } from "@/lib/contributions/pending";
import { missingAudioRanking, RANKING_LIMIT } from "@/lib/contributions/missing-audio";
import { viewersIn } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { can, CAPABILITIES, isAdmin, type Capability } from "@/lib/permissions";
import { pendingBySection } from "@/lib/releases/pending";
import { RELEASE_SECTIONS, type PendingView, type ReleaseSection } from "@/lib/releases/sections";
import type { Category, Queue } from "@/lib/reports/reports";
import { openReportCounts } from "@/lib/reports/store";
import { readAs } from "@/lib/teams/store";
import { namesOf } from "@/lib/users/store";

import { runsOf, type ActivityRun } from "./runs";

export type Dashboard = {
  release: (PendingView & { section: ReleaseSection })[];
  contributions: PendingCounts;
  reports: Record<Category, number>;
  /**
   * Of the most-heard silent lines the Missing audio page ranks, those with no take at all.
   * `capped` when the ranking stopped at its limit, so there may be more.
   */
  missing: {
    count: number;
    capped: boolean;
    top: { lineId: string; text: string | null; installs: number } | null;
  };
  /** Who holds each capability in the language, by name. */
  holders: Record<Capability, { id: string; name: string | null }[]>;
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
  const [pending, contributions, reports, ranking, grants, week, recent] = await Promise.all([
    pendingBySection(lang),
    pendingCounts(lang),
    openReportCounts(lang, queues),
    missingAudioRanking(lang),
    viewersIn(lang),
    weekIn(lang),
    listActivity({ lang, limit: RECENT_ROWS }),
  ]);

  const silent = ranking.filter((row) => !row.voiced);
  // What each person can do, as permissions.ts `can` reads their grants: admin in the language
  // holds every capability there but text. A site admin works everywhere and is no team's.
  const names = await namesOf([...grants.keys()]);
  const holders = Object.fromEntries(CAPABILITIES.map((capability) => [capability, []])) as unknown as Dashboard["holders"];
  for (const [id, viewer] of grants) {
    if (isAdmin(viewer.role)) continue;
    for (const capability of CAPABILITIES) {
      if (can(viewer, capability, lang)) holders[capability].push({ id, name: names.get(id) ?? null });
    }
  }

  return {
    release: RELEASE_SECTIONS.map((section) => ({ ...pending[section], section })),
    contributions,
    reports,
    missing: {
      count: silent.length,
      capped: ranking.length >= RANKING_LIMIT,
      top: silent[0] ? { lineId: silent[0].lineId, text: silent[0].text, installs: silent[0].installs } : null,
    },
    holders,
    week,
    recent: runsOf(recent.rows, RECENT_RUNS, { more: recent.next !== null }),
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
