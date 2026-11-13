/**
 * At most one run is active site-wide: the unique index holds across teams that cannot see each
 * other's rows.
 */
import "server-only";

import { ALL_TEAMS, withTeam } from "@/lib/db";
import { recordActivity } from "@/lib/activity/store";
import type { Lang } from "@/lib/lang";
import { asTeamOf, readAs } from "@/lib/teams/store";

import type { PackReleases } from "@/lib/reports/context";

import { isSettled, type ReleaseSection, type ReleaseState } from "./sections";

export type ReleaseRun = {
  id: string;
  teamId: string;
  section: ReleaseSection;
  lang: Lang;
  state: ReleaseState;
  githubRunId: number | null;
  githubUrl: string | null;
  step: string | null;
  error: string | null;
  version: string | null;
  requestedBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export class ReleaseBusyError extends Error {
  constructor(readonly active: { section: string; lang: Lang }) {
    super(`a release is already running: ${active.section} in ${active.lang}`);
  }
}

const COLUMNS = `"id", "teamId", "section", "lang", "state", "githubRunId"::float8 as "githubRunId", "githubUrl",
                 "step", "error", "version", "requestedBy", "createdAt", "finishedAt"`;
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
  patch: Partial<Pick<ReleaseRun, "state" | "githubRunId" | "githubUrl" | "step" | "error" | "version">>,
): Promise<ReleaseRun> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows: before } = await client.query<ReleaseRun>(
      `select ${COLUMNS} from "release_run" where "id" = $1 for update`,
      [id],
    );
    if (!before[0]) throw new Error(`no release run ${id}`);
    // Each process polls on its own, so a slower one can arrive after another has settled the
    // run; its write would take the lock again, or clash with the next press's.
    if (isSettled(before[0].state)) return before[0];
    const settles = patch.state && isSettled(patch.state) ? patch.state : null;
    const { rows } = await client.query<ReleaseRun>(
      `update "release_run" set
         "state" = coalesce($2, "state"),
         "githubRunId" = coalesce($3, "githubRunId"),
         "githubUrl" = coalesce($4, "githubUrl"),
         "step" = coalesce($5, "step"),
         "error" = coalesce($6, "error"),
         "version" = coalesce($7, "version"),
         "finishedAt" = case when $8 then coalesce("finishedAt", now()) else "finishedAt" end
       where "id" = $1 returning ${COLUMNS}`,
      [id, patch.state ?? null, patch.githubRunId ?? null, patch.githubUrl ?? null, patch.step ?? null,
       patch.error ?? null, patch.version ?? null, settles !== null],
    );
    const run = rows[0];
    if (settles) {
      await recordActivity(
        { kind: "release.finished", lang: run.lang, actorId: null, detail: { section: run.section, state: settles, ...(run.version ? { version: run.version } : {}) } },
        client,
      );
    }
    return run;
  });
}

/** Per section, its newest run that released something. */
export async function lastDoneRuns(lang: Lang): Promise<ReleaseRun[]> {
  return readAs<ReleaseRun>(
    lang,
    `select distinct on ("section") ${COLUMNS} from "release_run"
      where "lang" = $1 and "state" = 'done' order by "section", "createdAt" desc`,
    [lang],
  );
}

export async function recentRuns(lang: Lang, limit: number): Promise<ReleaseRun[]> {
  // A team can hold several languages, and a language no team owns reads as empty.
  return readAs<ReleaseRun>(
    lang,
    `select ${COLUMNS} from "release_run" where "lang" = $1 order by "createdAt" desc limit $2`,
    [lang, limit],
  );
}

/**
 * Per section, when the newest run that brought players up to date started: one that released,
 * or that found nothing to. Counted from the start because the build reads the takes then.
 */
export async function lastReleasedAt(lang: Lang): Promise<Map<string, Date>> {
  const rows = await readAs<{ section: string; at: Date }>(
    lang,
    `select "section", max("createdAt") as "at" from "release_run"
      where "lang" = $1 and "state" in ('done', 'unchanged') group by "section"`,
    [lang],
  );
  return new Map(rows.map((row) => [row.section, row.at]));
}

/**
 * Per language, every release of `section` that gave its pack a version, newest first, with
 * when it started: what a report's pack version and its line's live take are weighed against.
 * A release builds from the takes live when it starts. Public, as every pack's .toc on the
 * channel says the same, so read across teams. Releases made before the site ran them have no
 * row.
 */
export async function packReleases(section: string): Promise<PackReleases> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ lang: string; version: string; at: string }>(
      `select "lang", "version", to_json("createdAt") #>> '{}' as "at" from "release_run"
        where "section" = $1 and "state" = 'done' and "version" is not null
        order by "createdAt" desc`,
      [section],
    );
    const releases: PackReleases = {};
    for (const { lang, version, at } of rows) (releases[lang] ??= []).push({ version, at });
    return releases;
  });
}
