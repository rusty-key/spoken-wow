import "server-only";

import type { Lang } from "@/lib/lang";
import { ownerOrAll } from "@/lib/teams/store";

import { readDropletRun } from "./droplet";
import type { ReleaseView, RunView } from "./sections";
import { recentRuns, type ReleaseRun } from "./store";
import { syncActive } from "./sync";

const RECENT = 20;

const ownView = async (run: ReleaseRun): Promise<RunView> => ({
  section: run.section,
  lang: run.lang,
  state: run.state,
  own: true,
  githubUrl: run.githubUrl,
  step: run.step,
  error: run.error,
  log: (await readDropletRun(run.id))?.log ?? null,
});

/** What a caller of `lang` may see: the site-wide active run, whole only when it is their team's. */
export async function releaseView(lang: Lang): Promise<ReleaseView> {
  // In turn: a run that sync settles must show among the recent ones.
  const active = await syncActive();
  const recent = await recentRuns(lang, RECENT);
  let shown: RunView | null = null;
  if (active) {
    shown = active.teamId === (await ownerOrAll(lang))
      ? await ownView(active)
      : { section: active.section, lang: active.lang, state: active.state, own: false };
  }
  return { active: shown, recent: await Promise.all(recent.map(ownView)) };
}
