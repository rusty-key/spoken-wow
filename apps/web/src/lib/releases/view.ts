import "server-only";

import type { Lang } from "@/lib/lang";
import { ownerOrAll } from "@/lib/teams/store";
import { namesOf } from "@/lib/users/store";

import { readDropletRun, runsOnDroplet } from "./droplet";
import { pendingBySection } from "./pending";
import { isSettled, type ReleaseView, type RunView } from "./sections";
import { lastDoneRuns, recentRuns, type ReleaseRun } from "./store";
import { syncActive } from "./sync";

const RECENT = 20;

function ownView(run: ReleaseRun, names: Map<string, string>): RunView {
  return {
    section: run.section,
    lang: run.lang,
    state: run.state,
    own: true,
    githubUrl: run.githubUrl,
    step: run.step,
    error: run.error,
    version: run.version,
    startedAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    by: run.requestedBy ? (names.get(run.requestedBy) ?? null) : null,
  };
}

/** With its output, for the runs the page can open a log of: reading it is files per run, on every check. */
async function withLog(run: ReleaseRun, names: Map<string, string>): Promise<RunView> {
  const job = await readDropletRun(run.id);
  return { ...ownView(run, names), log: job?.log ?? null, logCut: job?.logCut ?? false };
}

/** What a caller of `lang` may see: the site-wide active run, whole only when it is their team's. */
export async function releaseView(lang: Lang): Promise<ReleaseView> {
  // In turn: a run that sync settles must show among the recent ones.
  const active = await syncActive();
  const recent = await recentRuns(lang, RECENT);
  const done = await lastDoneRuns(lang);
  const ours = active && active.teamId === (await ownerOrAll(lang)) ? active : null;
  const names = await namesOf([...(ours ? [ours] : []), ...recent, ...done].map((run) => run.requestedBy));
  let shown: RunView | null = null;
  if (active) {
    shown = ours
      ? await withLog(ours, names)
      : { section: active.section, lang: active.lang, state: active.state, own: false };
  }
  const pending = await pendingBySection(lang);
  // A card opens the log of its running run or its newest settled one, and no other.
  const opened = new Set<string>();
  return {
    active: shown,
    recent: await Promise.all(
      recent.map((run) => {
        if (!isSettled(run.state) || opened.has(run.section)) return ownView(run, names);
        opened.add(run.section);
        return withLog(run, names);
      }),
    ),
    released: Object.fromEntries(done.map((run) => [run.section, ownView(run, names)])),
    bumpable: runsOnDroplet(),
    pending,
  };
}
