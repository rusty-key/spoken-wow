/**
 * A site owner's review of a team's staged release, and delisting a team's pack
 * (docs/platform/TEAMS.md, *Releases*). Approving makes the staged run `approved` and queues a
 * `promote` run, which lists what the release staged; its success makes the staged run `done`,
 * and its failure puts it back to wait (store.ts). Rejecting settles it
 * `rejected` with the reason. Delisting queues a `delist` run, which resolves the team's folders
 * and takes them out of both indexes. Each records activity under the run's team, and emails after the commit.
 */
import "server-only";

import type { PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, withTeam } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asTeam } from "@/lib/teams/acting";
import { namesOf } from "@/lib/users/store";
import { isUuid } from "@/lib/uuid";

import { runsOnDroplet } from "./droplet";
import { begin, failureOf } from "./launch";
import { tellPresser } from "./notify";
import { pendingChanges } from "./pending";
import { isReleaseSection, type LiveTeamPack, type PendingView, type ReleaseSection, type WaitingVersion } from "./sections";
import { COLUMNS, insertRun, runById, type ReleaseRun } from "./store";
import { syncActive } from "./sync";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

async function waitingRun(client: PoolClient, runId: string): Promise<ReleaseRun> {
  const none = new ReviewError("No such release.", 404);
  if (!isUuid(runId)) throw none;
  const { rows } = await client.query<ReleaseRun>(
    `select ${COLUMNS} from "release_run" where "id" = $1 and "kind" = 'release' for update`,
    [runId],
  );
  const run = rows[0];
  if (!run) throw none;
  if (run.state === "superseded") throw new ReviewError("A newer version of this pack replaced it; review that one.", 409);
  if (run.state === "approved") throw new ReviewError("It is approved already, and being listed.", 409);
  if (run.state !== "awaiting_review") throw new ReviewError("It is not waiting for review.", 409);
  return run;
}

/**
 * Approves a staged version: it is `approved` at once, so nothing rejects or replaces it while its
 * promotion waits its turn like any run and lists it once it runs.
 */
export async function approve(runId: string, actorId: string): Promise<ReleaseRun> {
  if (!runsOnDroplet()) throw new ReviewError("Only the site that signs the channel can list a release.", 409);
  // A finished run nobody settled yet would otherwise keep the promotion queued behind it.
  await syncActive();
  const promote = await withTeam(ALL_TEAMS, async (client) => {
    const run = await waitingRun(client, runId);
    await client.query(
      `update "release_run" set "state" = 'approved', "reviewedBy" = $2, "reviewedAt" = now(), "reviewNote" = null, "error" = null
        where "id" = $1`,
      [run.id, actorId],
    );
    const promote = await insertRun(client, {
      kind: "promote", teamId: run.teamId, section: run.section, lang: run.lang, requestedBy: actorId,
      staged: run.staged, promotes: run.id,
    });
    await recordActivity(
      { kind: "release.approved", lang: run.lang, actorId, subject: run.id, detail: { section: run.section, ...(run.version ? { version: run.version } : {}) }, team: run.teamId },
      client,
    );
    return promote;
  });
  return started(promote);
}

/** A run made here, started when it took the lock; its job failing to start is a 502. */
async function started(run: ReleaseRun): Promise<ReleaseRun> {
  try {
    await begin(run);
  } catch (error) {
    throw new ReviewError(`It could not start: ${failureOf(error)}`, 502);
  }
  return (await runById(run.id)) ?? run;
}

/** Rejects a staged version with the reason, which its team sees. Nothing on the channel changes. */
export async function reject(runId: string, actorId: string, note: string): Promise<ReleaseRun> {
  const reason = note.trim();
  if (!reason) throw new ReviewError("Say why it is not approved: the team sees it.", 400);
  const run = await withTeam(ALL_TEAMS, async (client) => {
    await waitingRun(client, runId);
    const { rows } = await client.query<ReleaseRun>(
      `update "release_run" set "state" = 'rejected', "reviewedBy" = $2, "reviewedAt" = now(), "reviewNote" = $3
        where "id" = $1 returning ${COLUMNS}`,
      [runId, actorId, reason],
    );
    const run = rows[0];
    await recordActivity(
      {
        kind: "release.rejected", lang: run.lang, actorId, subject: run.id,
        detail: { section: run.section, reason, ...(run.version ? { version: run.version } : {}) }, team: run.teamId,
      },
      client,
    );
    return run;
  });
  await tellPresser(run, "rejected", reason);
  return run;
}

/**
 * Takes a team's pack in one section and language off the channel. The job resolves every folder
 * the team's pack can have (`cli.mjs delist`), not only those its last version changed: a quests
 * release stages only the sides that changed. An official team's pack is not delisted here; the
 * release workflow is the way.
 */
export async function delistPack(teamId: string, lang: Lang, section: string, actorId: string): Promise<ReleaseRun> {
  if (!isReleaseSection(section)) throw new ReviewError("No such section.", 400);
  if (!isUuid(teamId)) throw new ReviewError("No such team.", 404);
  if (!runsOnDroplet()) throw new ReviewError("Only the site that signs the channel can delist a pack.", 409);
  await syncActive();
  const run = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ official: boolean }>(`select "official" from "team" where "id" = $1`, [teamId]);
    const team = rows[0];
    if (!team) throw new ReviewError("No such team.", 404);
    if (team.official) throw new ReviewError("An official team's packs are not delisted here.", 409);
    const run = await insertRun(client, { kind: "delist", teamId, section, lang, requestedBy: actorId });
    await recordActivity(
      { kind: "release.delisted", lang, actorId, subject: run.id, detail: { section }, team: teamId },
      client,
    );
    return run;
  });
  return started(run);
}

const WAITING = `from "release_run" r join "team" t on t."id" = r."teamId"
                 where r."kind" = 'release' and r."state" in ('awaiting_review', 'approved')`;

/** How many versions wait for a site owner, approved ones still being listed among them, for the header's badge. */
export async function waitingCount(): Promise<number> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ count: string }>(`select count(*) as "count" ${WAITING}`);
    return Number(rows[0].count);
  });
}

/**
 * When the team's last release that brought players up to date started, which a waiting version
 * `r` counts from: as its team's release page counts it (store.ts lastReleasedAt).
 */
const SINCE = `(select max(s."createdAt") from "release_run" s
                 where s."kind" = 'release' and s."state" in ('done', 'unchanged')
                   and s."teamId" = r."teamId" and s."lang" = r."lang" and s."section" = r."section")`;

type WaitingRow = {
  id: string; teamId: string; slug: string; name: string; lang: Lang; section: ReleaseSection; version: string | null;
  requestedBy: string | null; createdAt: Date; error: string | null; approving: boolean; since: Date | null;
};

/**
 * What a waiting version changes for players, as its team counts it, read as that team: up to
 * when it was pressed, with the takes live then, which its build read. Takes cut since wait for
 * the team's next release.
 */
function changesOf(row: Pick<WaitingRow, "teamId" | "lang" | "section" | "since" | "createdAt">, list: boolean): Promise<PendingView> {
  return asTeam(row.lang, row.teamId, () =>
    pendingChanges(row.section, row.lang, row.since, { list, people: true, until: row.createdAt }),
  );
}

/**
 * Every version waiting for review, oldest first, each with what it changes for players as its
 * team's own release page counted it when it was pressed: the team's takes live then, since its
 * last approved release. The
 * counts and people only; the dialog asks for the lines (waitingLines).
 */
export async function waitingReviews(): Promise<WaitingVersion[]> {
  const rows = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<WaitingRow>(
      `select r."id", r."teamId", t."slug", t."name", r."lang", r."section", r."version", r."requestedBy",
              r."createdAt", r."error", r."state" = 'approved' as "approving", ${SINCE} as "since"
         ${WAITING} order by r."createdAt"`,
    );
    return rows;
  });
  const names = await namesOf(rows.map((row) => row.requestedBy));
  // One after another: each count holds a connection while it runs.
  const waiting: WaitingVersion[] = [];
  for (const row of rows) {
    waiting.push({
      id: row.id,
      team: { id: row.teamId, slug: row.slug, name: row.name },
      lang: row.lang,
      section: row.section,
      version: row.version,
      by: row.requestedBy ? (names.get(row.requestedBy) ?? null) : null,
      pressedAt: row.createdAt.toISOString(),
      error: row.error,
      approving: row.approving,
      pending: await changesOf(row, false),
    });
  }
  return waiting;
}

/** A waiting version's lines, as its review dialog lists them; null when no version waits by that id. */
export async function waitingLines(runId: string): Promise<PendingView | null> {
  if (!isUuid(runId)) return null;
  const row = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<Pick<WaitingRow, "teamId" | "lang" | "section" | "since" | "createdAt">>(
      `select r."teamId", r."lang", r."section", r."createdAt", ${SINCE} as "since" ${WAITING} and r."id" = $1`,
      [runId],
    );
    return rows[0];
  });
  return row ? changesOf(row, true) : null;
}

/**
 * The packs of teams that are not official which players have: each team's newest approved
 * version per section and language, unless a site owner delisted it since.
 */
export async function liveTeamPacks(): Promise<LiveTeamPack[]> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{
      teamId: string; slug: string; name: string; lang: Lang; section: ReleaseSection; version: string | null; at: Date;
    }>(
      `select * from (
         select distinct on (r."teamId", r."lang", r."section")
                r."teamId", t."slug", t."name", r."lang", r."section", r."version", coalesce(r."finishedAt", r."createdAt") as "at"
           from "release_run" r join "team" t on t."id" = r."teamId"
          where r."kind" = 'release' and r."state" = 'done' and not t."official"
          order by r."teamId", r."lang", r."section", r."createdAt" desc
       ) live
       where not exists (select 1 from "release_run" d
                          where d."kind" = 'delist' and d."state" = 'done' and d."teamId" = live."teamId"
                            and d."lang" = live."lang" and d."section" = live."section"
                            -- When it took the pack off: a delisting pressed while the listing ran waits behind it.
                            and coalesce(d."finishedAt", d."createdAt") > live."at")
       order by live."lang", live."section", live."name"`,
    );
    return rows.map((row) => ({
      team: { id: row.teamId, slug: row.slug, name: row.name },
      lang: row.lang,
      section: row.section,
      version: row.version,
      releasedAt: row.at.toISOString(),
    }));
  });
}
