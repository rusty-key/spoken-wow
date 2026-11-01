/**
 * At most one run is active site-wide: the unique index holds across teams that cannot see each
 * other's rows.
 */
import "server-only";

import { ALL_TEAMS, withTeam } from "@/lib/db";
import { recordActivity } from "@/lib/activity/store";
import type { Lang } from "@/lib/lang";
import { asTeamOf, readAs } from "@/lib/teams/store";

import type { ReleaseState } from "./sections";

export type ReleaseRun = {
  id: string;
  teamId: string;
  section: string;
  lang: Lang;
  state: ReleaseState;
  githubRunId: number | null;
  githubUrl: string | null;
  step: string | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export class ReleaseBusyError extends Error {
  constructor(readonly active: { section: string; lang: string }) {
    super(`a release is already running: ${active.section} in ${active.lang}`);
  }
}

const COLUMNS = `"id", "teamId", "section", "lang", "state", "githubRunId"::float8 as "githubRunId", "githubUrl",
                 "step", "error", "createdAt", "finishedAt"`;
const ACTIVE = `"state" in ('dispatching', 'running')`;
const UNIQUE_VIOLATION = "23505";

export async function activeRun(): Promise<ReleaseRun | null> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<ReleaseRun>(`select ${COLUMNS} from "release_run" where ${ACTIVE}`);
    return rows[0] ?? null;
  });
}

export async function startRun(section: string, lang: Lang, userId: string): Promise<ReleaseRun> {
  // A second try only for the run that finished between the violation and the read.
  for (let attempt = 0; ; attempt++) {
    try {
      return await asTeamOf(lang, async (client) => {
        const { rows } = await client.query<ReleaseRun>(
          `insert into "release_run" ("section", "lang", "state", "requestedBy")
           values ($1, $2, 'dispatching', $3) returning ${COLUMNS}`,
          [section, lang, userId],
        );
        await recordActivity({ kind: "release.started", lang, actorId: userId, detail: { section } }, client);
        return rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      // The violation aborted that transaction; the other team's row is read in a new one.
      const active = await activeRun();
      if (active) throw new ReleaseBusyError({ section: active.section, lang: active.lang });
      if (attempt > 0) throw error;
    }
  }
}

export async function updateRun(
  id: string,
  patch: Partial<Pick<ReleaseRun, "state" | "githubRunId" | "githubUrl" | "step" | "error">>,
): Promise<ReleaseRun> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows: before } = await client.query<ReleaseRun>(
      `select ${COLUMNS} from "release_run" where "id" = $1 for update`,
      [id],
    );
    if (!before[0]) throw new Error(`no release run ${id}`);
    // Each process polls on its own, so a slower one can arrive after another has settled the
    // run; its write would take the lock again, or clash with the next press's.
    if (before[0].state === "done" || before[0].state === "failed") return before[0];
    const settles = patch.state === "done" || patch.state === "failed" ? patch.state : null;
    const { rows } = await client.query<ReleaseRun>(
      `update "release_run" set
         "state" = coalesce($2, "state"),
         "githubRunId" = coalesce($3, "githubRunId"),
         "githubUrl" = coalesce($4, "githubUrl"),
         "step" = coalesce($5, "step"),
         "error" = coalesce($6, "error"),
         "finishedAt" = case when $7 then coalesce("finishedAt", now()) else "finishedAt" end
       where "id" = $1 returning ${COLUMNS}`,
      [id, patch.state ?? null, patch.githubRunId ?? null, patch.githubUrl ?? null, patch.step ?? null,
       patch.error ?? null, settles !== null],
    );
    const run = rows[0];
    if (settles) {
      await recordActivity(
        { kind: "release.finished", lang: run.lang, actorId: null, detail: { section: run.section, state: settles } },
        client,
      );
    }
    return run;
  });
}

export async function recentRuns(lang: Lang, limit: number): Promise<ReleaseRun[]> {
  // A team can hold several languages, and a language no team owns reads as empty.
  return readAs<ReleaseRun>(
    lang,
    `select ${COLUMNS} from "release_run" where "lang" = $1 order by "createdAt" desc limit $2`,
    [lang, limit],
  );
}
