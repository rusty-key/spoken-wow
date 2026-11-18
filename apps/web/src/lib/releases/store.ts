/**
 * At most one run is active site-wide: the unique index holds across teams that cannot see each
 * other's rows. A press while one is active waits `queued`, and settling a run starts the oldest
 * queued one (claimNext, then launch.ts), so two runs never write the channel's indexes at once.
 */
import "server-only";

import type { PoolClient } from "pg";

import { ALL_TEAMS, withTeam } from "@/lib/db";
import { recordActivity } from "@/lib/activity/store";
import type { Lang } from "@/lib/lang";
import { readAs, teamOf } from "@/lib/teams/store";

import type { PackRelease, PackVersions } from "@/lib/reports/context";

import { isSettled, type ReleaseBump, type ReleaseKind, type ReleaseSection, type ReleaseState } from "./sections";

/**
 * What a staged release put on the channel without listing it, by folder, as publish.mjs returns
 * it (`publish({ stage: true })`): each folder's index entry and the live rev it was staged over.
 */
export type StagedEntries = Record<string, Record<string, unknown> & { rev: string; baseRev: string | null }>;

export type ReleaseRun = {
  id: string;
  kind: ReleaseKind;
  teamId: string;
  /** The team's slug, which names it to the release job. */
  teamSlug: string;
  section: ReleaseSection;
  lang: Lang;
  state: ReleaseState;
  /** What the press asked for, which a queued run needs when it starts; null before runs kept it. */
  bump: ReleaseBump | null;
  /** A release that uploads but lists nothing, for a site owner to review. */
  stage: boolean;
  /**
   * A staged release's entries once it reaches review, and a promote run's copy of them; a delist
   * run's folders, as `{ folders }`.
   */
  staged: StagedEntries | { folders: string[] } | null;
  /** A promote run's staged run. */
  promotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
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

export const COLUMNS = `"id", "kind", "teamId", (select t."slug" from "team" t where t."id" = "release_run"."teamId") as "teamSlug",
                 "section", "lang", "state", "bump", "stage", "staged", "promotes", "reviewedBy", "reviewedAt", "reviewNote",
                 "githubRunId"::float8 as "githubRunId", "githubUrl",
                 "step", "error", "version", "requestedBy", "createdAt", "finishedAt"`;
const ACTIVE = `"state" in ('dispatching', 'running')`;
const UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === UNIQUE_VIOLATION;

export async function activeRun(): Promise<ReleaseRun | null> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<ReleaseRun>(`select ${COLUMNS} from "release_run" where ${ACTIVE}`);
    return rows[0] ?? null;
  });
}

/** Any team's run, for a caller that checks who may see it. */
export async function runById(id: string): Promise<ReleaseRun | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<ReleaseRun>(`select ${COLUMNS} from "release_run" where "id" = $1`, [id]);
    return rows[0] ?? null;
  });
}

export type NewRun = {
  kind?: ReleaseKind;
  teamId: string;
  section: string;
  lang: Lang;
  requestedBy: string | null;
  bump?: ReleaseBump | null;
  stage?: boolean;
  staged?: ReleaseRun["staged"];
  promotes?: string | null;
  /** Whether it may wait for another run; without, a press while one is active is refused. */
  queue?: boolean;
};

/**
 * A run of any kind, on `client` (as ALL_TEAMS): `dispatching` when nothing is active or waiting,
 * else `queued`, so the queue keeps press order. Without `queue`, a busy lock is ReleaseBusyError.
 */
export async function insertRun(client: PoolClient, run: NewRun): Promise<ReleaseRun> {
  const insert = (state: ReleaseState) =>
    client.query<ReleaseRun>(
      `insert into "release_run" ("kind", "teamId", "section", "lang", "state", "requestedBy", "bump", "stage", "staged", "promotes")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${COLUMNS}`,
      [run.kind ?? "release", run.teamId, run.section, run.lang, state, run.requestedBy, run.bump ?? null,
       run.stage ?? false, run.staged ? JSON.stringify(run.staged) : null, run.promotes ?? null],
    );
  const queue = run.queue ?? true;
  const { rowCount: waiting } = queue
    ? await client.query(`select 1 from "release_run" where "state" = 'queued' limit 1`)
    : { rowCount: 0 };
  if (waiting) return (await insert("queued")).rows[0];
  await client.query("savepoint press");
  try {
    return (await insert("dispatching")).rows[0];
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await client.query("rollback to savepoint press");
    if (queue) return (await insert("queued")).rows[0];
    const { rows } = await client.query<{ section: string; lang: Lang }>(`select "section", "lang" from "release_run" where ${ACTIVE}`);
    // The active run settled between the insert and the read: one more try.
    if (!rows[0]) return (await insert("dispatching")).rows[0];
    throw new ReleaseBusyError(rows[0]);
  }
}

/** A press of Release, under the team the acting person works on `lang` in. */
export async function startRun(
  section: string,
  lang: Lang,
  userId: string,
  { bump = "patch", stage = false, queue = true }: { bump?: ReleaseBump; stage?: boolean; queue?: boolean } = {},
): Promise<ReleaseRun> {
  const teamId = await teamOf(lang);
  return withTeam(ALL_TEAMS, async (client) => {
    const run = await insertRun(client, { teamId, section, lang, requestedBy: userId, bump, stage, queue });
    await recordActivity({ kind: "release.started", lang, actorId: userId, detail: { section }, team: teamId }, client);
    return run;
  });
}

/**
 * The oldest queued run, now `dispatching`, when nothing is active; null otherwise. Two workers
 * asking at once start one: the skipped lock and the one-active index stop the second.
 */
export async function claimNext(): Promise<ReleaseRun | null> {
  try {
    return await withTeam(ALL_TEAMS, async (client) => {
      const { rowCount: busy } = await client.query(`select 1 from "release_run" where ${ACTIVE}`);
      if (busy) return null;
      const { rows } = await client.query<ReleaseRun>(
        `update "release_run" set "state" = 'dispatching'
          where "id" = (select "id" from "release_run" where "state" = 'queued'
                         order by "createdAt", "id" limit 1 for update skip locked)
          returning ${COLUMNS}`,
      );
      return rows[0] ?? null;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Cancels a run still waiting its turn; null when it is not queued any more. */
export async function cancelQueued(id: string): Promise<ReleaseRun | null> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<ReleaseRun>(
      `update "release_run" set "state" = 'failed', "error" = 'Cancelled', "finishedAt" = now()
        where "id" = $1 and "state" = 'queued' returning ${COLUMNS}`,
      [id],
    );
    const run = rows[0];
    if (run?.kind === "release") await recordFinish(run, "failed", client);
    return run ?? null;
  });
}

async function recordFinish(run: ReleaseRun, state: ReleaseState, client: PoolClient): Promise<void> {
  await recordActivity(
    {
      kind: "release.finished",
      lang: run.lang,
      actorId: null,
      detail: { section: run.section, state: state as "done" | "unchanged" | "failed", ...(run.version ? { version: run.version } : {}) },
      team: run.teamId,
    },
    client,
  );
}

export async function updateRun(
  id: string,
  patch: Partial<Pick<ReleaseRun, "state" | "githubRunId" | "githubUrl" | "step" | "error" | "version" | "staged">>,
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
         "staged" = coalesce($9, "staged"),
         "finishedAt" = case when $8 then coalesce("finishedAt", now()) else "finishedAt" end
       where "id" = $1 returning ${COLUMNS}`,
      [id, patch.state ?? null, patch.githubRunId ?? null, patch.githubUrl ?? null, patch.step ?? null,
       patch.error ?? null, patch.version ?? null, settles !== null, patch.staged ? JSON.stringify(patch.staged) : null],
    );
    const run = rows[0];
    // A promotion or delisting is recorded as the review that asked for it (review.ts).
    if (settles && run.kind === "release") await recordFinish(run, settles, client);
    return run;
  });
}

/** Per section, its newest run that released something. */
export async function lastDoneRuns(lang: Lang): Promise<ReleaseRun[]> {
  return readAs<ReleaseRun>(
    lang,
    `select distinct on ("section") ${COLUMNS} from "release_run"
      where "lang" = $1 and "kind" = 'release' and "state" = 'done' order by "section", "createdAt" desc`,
    [lang],
  );
}

export async function recentRuns(lang: Lang, limit: number): Promise<ReleaseRun[]> {
  // A team can hold several languages, and a language no team owns reads as empty.
  return readAs<ReleaseRun>(
    lang,
    `select ${COLUMNS} from "release_run" where "lang" = $1 and "kind" <> 'promote' order by "createdAt" desc limit $2`,
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
      where "lang" = $1 and "kind" = 'release' and "state" in ('done', 'unchanged') group by "section"`,
    [lang],
  );
  return new Map(rows.map((row) => [row.section, row.at]));
}

/**
 * The releases of `section` in `lang` that gave its pack a version, newest first, with when each
 * started: a release builds from the takes live when it starts. What a report page weighs the
 * player's pack and the line's live take against. Public, as every pack's .toc on the channel
 * says the same, so read across teams. Releases made before the site ran them have no row.
 */
export async function packReleases(section: string, lang: Lang): Promise<PackRelease[]> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ version: string; createdAt: Date }>(
      `select "version", "createdAt" from "release_run"
        where "section" = $1 and "lang" = $2 and "kind" = 'release' and "state" = 'done' and "version" is not null
        order by "createdAt" desc`,
      [section, lang],
    );
    return rows.map((row) => ({ version: row.version, at: row.createdAt.toISOString() }));
  });
}

/** Per language, the version the newest release of `section` gave its pack: what triage flags against. */
export async function latestPackVersions(section: string): Promise<PackVersions> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ lang: string; version: string }>(
      `select distinct on ("lang") "lang", "version" from "release_run"
        where "section" = $1 and "kind" = 'release' and "state" = 'done' and "version" is not null
        order by "lang", "createdAt" desc`,
      [section],
    );
    return Object.fromEntries(rows.map((row) => [row.lang, row.version]));
  });
}
