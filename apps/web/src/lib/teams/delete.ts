/**
 * Deleting a team (docs/platform/TEAMS.md, *Deleting a team*). startDeletion marks the team
 * `deletingAt`, which stops it making anything (migration 0124), cancels its pending generation and
 * queues a `delist` run per pack it may have on the channel. When the last of them settles, the
 * release queue's settle hook (releases/store.ts) calls settleDeletion, which deletes its rows in
 * the same transaction. With no pack to delist, they go at once. Nothing is deleted while any
 * delisting is still to run, and a failed one stops the deletion with its reason until a Retry.
 */
import "server-only";

import type { ClientBase, PoolClient } from "pg";

import { recordActivities, recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, withTeam } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { setEnabledOn } from "@/lib/languages/store";
import type { Capability } from "@/lib/permissions";
import { runsOnDroplet } from "@/lib/releases/droplet";
import { launchRun, launchStarted, type Launch } from "@/lib/releases/launch";
import { liveTeamPacks } from "@/lib/releases/review";
import { isSettled, RELEASE_SECTIONS, UNSETTLED_STATES, type ReleaseSection, type ReleaseState } from "@/lib/releases/sections";
import { insertRun, type ReleaseRun } from "@/lib/releases/store";
import { syncActive } from "@/lib/releases/sync";

import { TeamError } from "./admin";
import { membersOf } from "./members";
import { forgetTeams, TEAM_ORDER, type TeamId } from "./store";

/**
 * Every table with a team's rows that goes with it, children before parents. Reports are not
 * here: they move. team_member, team_language and invite cascade from the team.
 */
export const DELETED = [
  // Generation, cancelled first. Jobs cascade from their batch, but a job's team is its own.
  "regeneration_job", "regeneration_batch", "regeneration_pause", "queue_dismissal",
  // Its work.
  "take_ack", "take", "recording", "line_flag", "line_issue_line", "line_issue", "line_ignore",
  "line_override", "text_override",
  // Its roster, generation settings and lexicon.
  "voice_assignment", "voice", "voice_clone", "voice_sample", "fish_reference",
  "generation_setting_locale", "generation_setting", "lexicon_change",
  "pronunciation_lexicon_locale", "pronunciation_lexicon",
  "release_run",
  // Rows only: the objects stay in the bucket (AGENTS.md).
  "archive_object", "storage_move", "storage_backend",
  "activity",
] as const;

export type DeletedTable = (typeof DELETED)[number];

/** A pack of the team players can install: its newest release of the pack, not delisted since. */
export type LivePack = { lang: Lang; section: ReleaseSection; version: string | null };

export type DeletionPreview = {
  id: TeamId;
  slug: string;
  name: string;
  /** Each language it voices, `alone` where no other team does, which leaves it switched off. */
  langs: { lang: Lang; alone: boolean }[];
  members: { email: string; lang: Lang; capability: Capability }[];
  /** Its rows in each table that goes with it, and all its reports. */
  counts: Record<DeletedTable | "report", number>;
  /** Its reports by what becomes of them: text ones move, open voice ones close. */
  reports: { moving: number; closing: number };
  /** Generation that has not started, which is cancelled. */
  pending: number;
  packs: LivePack[];
  /** Why it cannot be deleted now; null when it can. */
  refusal: string | null;
};

/** Its packs on the channel, from its releases: a release made before the site ran them has no row. */
export async function livePacks(client: ClientBase, team: TeamId): Promise<LivePack[]> {
  return (await liveTeamPacks({ team, client })).map(({ lang, section, version }) => ({ lang, section, version }));
}

/** A release of the team under way, or approved and waiting to be listed. */
const RELEASE_UNDER_WAY: readonly ReleaseState[] = [...UNSETTLED_STATES, "approved"];

/** Why `team` cannot be deleted now, or null. On the caller's client, as ALL_TEAMS. */
export async function refusalOf(
  client: ClientBase,
  team: { id: TeamId; slug: string; deletingAt: Date | null },
): Promise<string | null> {
  if (team.deletingAt) return `${team.slug} is being deleted already.`;
  const { rows } = await client.query<{ english: boolean; busy: boolean }>(
    `select exists (select 1 from "team_language" where "teamId" = $1 and "lang" = $2) as "english",
            exists (select 1 from "release_run" where "teamId" = $1 and "state" = any($3)) as "busy"`,
    [team.id, BASE_LANG, RELEASE_UNDER_WAY],
  );
  if (rows[0].english) return "English's team cannot be deleted: every other language is built from it.";
  if (rows[0].busy) return `${team.slug} has a release under way; delete it once that is finished.`;
  return null;
}

type TeamRow = { id: TeamId; slug: string; name: string; deletingAt: Date | null; deleteError: string | null };

export async function teamRow(client: ClientBase, team: TeamId, lock = false): Promise<TeamRow> {
  const { rows } = await client.query<TeamRow>(
    `select "id", "slug", "name", "deletingAt", "deleteError" from "team" where "id" = $1${lock ? " for update" : ""}`,
    [team],
  );
  if (!rows[0]) throw new TeamError("No such team.", 404);
  return rows[0];
}

/** Its rows in each table, its reports by what becomes of them, and its generation not yet started: one read. */
async function countsOf(client: ClientBase, team: TeamId): Promise<Pick<DeletionPreview, "counts" | "reports" | "pending">> {
  const tables = [...DELETED, "report"] as const;
  const { rows } = await client.query<Record<string, string>>(
    `select ${tables.map((table) => `(select count(*) from "${table}" where "teamId" = $1) as "${table}"`).join(", ")},
            (select count(*) from "report" where "teamId" = $1 and "queue" = 'text') as "moving",
            (select count(*) from "report" where "teamId" = $1 and "queue" = 'audio' and "status" = 'open') as "closing",
            (select count(*) from "regeneration_job" where "teamId" = $1 and "state" = 'pending') as "pending"`,
    [team],
  );
  const [row] = rows;
  return {
    counts: Object.fromEntries(tables.map((table) => [table, Number(row[table])])) as DeletionPreview["counts"],
    reports: { moving: Number(row.moving), closing: Number(row.closing) },
    pending: Number(row.pending),
  };
}

/** Each language of the team, `alone` where no other team voices it that is not being deleted too. */
async function langsOf(client: ClientBase, team: TeamId): Promise<DeletionPreview["langs"]> {
  const { rows } = await client.query<{ lang: Lang; alone: boolean }>(
    `select tl."lang", not exists (select 1 from "team_language" o join "team" t on t."id" = o."teamId"
                                    where o."lang" = tl."lang" and o."teamId" <> $1 and t."deletingAt" is null) as "alone"
       from "team_language" tl where tl."teamId" = $1 order by tl."lang"`,
    [team],
  );
  return rows;
}

export async function deletionPreview(team: TeamId): Promise<DeletionPreview> {
  return withTeam(ALL_TEAMS, async (client) => {
    const row = await teamRow(client, team);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      langs: await langsOf(client, team),
      members: await membersOf(client, team),
      ...(await countsOf(client, team)),
      packs: await livePacks(client, team),
      refusal: await refusalOf(client, row),
    };
  });
}

/**
 * Every pack of the team a delisting takes off the channel: those its releases put there, and
 * every section where its packs are plain, which `make manager-release` published before the site
 * ran releases, leaving no row. A team whose packs carry its slug only ever released here.
 */
async function packsToDelist(client: ClientBase, team: TeamId): Promise<{ lang: Lang; section: ReleaseSection }[]> {
  const packs = new Map<string, { lang: Lang; section: ReleaseSection }>();
  for (const { lang, section } of await livePacks(client, team)) packs.set(`${lang}:${section}`, { lang, section });
  const { rows } = await client.query<{ lang: Lang }>(
    `select "lang" from "team_language" where "teamId" = $1 and "packName" = 'plain' order by "lang"`,
    [team],
  );
  for (const { lang } of rows) {
    for (const section of RELEASE_SECTIONS) packs.set(`${lang}:${section}`, { lang, section });
  }
  return [...packs.values()].sort((a, b) => `${a.lang}:${a.section}`.localeCompare(`${b.lang}:${b.section}`));
}

/**
 * Marks the team deleting from now and queues its delistings, returning the first for the caller
 * to launch after the commit. With none to queue, deletes it at once and returns null.
 */
async function begin(client: PoolClient, team: TeamRow, actorId: string): Promise<ReleaseRun | null> {
  const packs = await packsToDelist(client, team.id);
  if (packs.length && !runsOnDroplet()) {
    throw new TeamError("Only the site that signs the channel can take its packs off it; delete the team there.", 409);
  }
  await client.query(`update "team" set "deletingAt" = now(), "deleteError" = null where "id" = $1`, [team.id]);
  // Running jobs are left alone and end refused (the take trigger); their takes would go with the
  // team anyway.
  await client.query(
    `update "regeneration_job" set "state" = 'cancelled', "finishedAt" = now() where "teamId" = $1 and "state" = 'pending'`,
    [team.id],
  );
  await client.query(
    `update "regeneration_batch" set "stoppedAt" = now(), "stoppedBecause" = 'The team is being deleted'
      where "teamId" = $1 and "stoppedAt" is null`,
    [team.id],
  );
  // Approved after the delisting, a waiting version would put the pack back.
  await client.query(
    `update "release_run" set "state" = 'rejected', "reviewedBy" = $2, "reviewedAt" = now(), "reviewNote" = 'The team is being deleted.'
      where "teamId" = $1 and "state" = 'awaiting_review'`,
    [team.id, actorId],
  );
  if (!packs.length) {
    await finishDeletion(client, team.id, actorId);
    return null;
  }
  let first: ReleaseRun | null = null;
  for (const pack of packs) {
    const run = await insertRun(client, { kind: "delist", teamId: team.id, ...pack, requestedBy: actorId });
    first ??= run;
  }
  return first;
}

/**
 * Starts deleting `team` once `typedSlug` is its slug: "deleted" when it had no pack to delist,
 * else "deleting" until its delistings settle.
 */
export async function startDeletion(
  team: TeamId,
  actorId: string,
  typedSlug: string,
  launch: Launch = launchRun,
): Promise<"deleting" | "deleted"> {
  return deletion(team, actorId, launch, async (client, row) => {
    if (typedSlug.trim() !== row.slug) throw new TeamError(`Type the team's slug, ${row.slug}, to delete it.`, 400);
    const refusal = await refusalOf(client, row);
    if (refusal) throw new TeamError(refusal, 409);
  });
}

/** A deletion that stopped on a failure, started again from its delistings. */
export async function retryDeletion(team: TeamId, actorId: string, launch: Launch = launchRun): Promise<"deleting" | "deleted"> {
  return deletion(team, actorId, launch, async (_client, row) => {
    if (!row.deletingAt) throw new TeamError(`${row.slug} is not being deleted.`, 409);
    if (!row.deleteError) throw new TeamError(`${row.slug} is still being deleted.`, 409);
  });
}

/** begin on the team, locked, once `guard` lets it through; then its first run launched. */
async function deletion(
  team: TeamId,
  actorId: string,
  launch: Launch,
  guard: (client: PoolClient, row: TeamRow) => Promise<void>,
): Promise<"deleting" | "deleted"> {
  // A finished run would hold the lock until somebody looked.
  await syncActive();
  const first = await withTeam(ALL_TEAMS, async (client) => {
    const row = await teamRow(client, team, true);
    await guard(client, row);
    return begin(client, row, actorId);
  });
  return launched(first, launch);
}

/** `first` is begin's: null when it deleted the team at once. */
async function launched(first: ReleaseRun | null, launch: Launch): Promise<"deleting" | "deleted"> {
  if (!first) {
    forgetTeams();
    return "deleted";
  }
  // A job that cannot start fails its run, and the deletion says so once the rest settle.
  if (first.state === "dispatching") await launchStarted(first, launch).catch(() => {});
  return "deleting";
}

/**
 * Called as a `delist` run settles, in its transaction. Once the last of a deletion's delistings
 * has settled, the team is deleted if every one succeeded, and stops with the reason if one
 * failed. A delete that fails stops it too, and the run still settles.
 */
export async function settleDeletion(client: PoolClient, run: ReleaseRun): Promise<void> {
  // Locked, so two delistings settling at once see each other's commit.
  const { rows } = await client.query<{ deletingAt: Date | null }>(
    `select "deletingAt" from "team" where "id" = $1 for update`,
    [run.teamId],
  );
  const since = rows[0]?.deletingAt;
  if (!since || run.createdAt < since) return;
  const { rows: runs } = await client.query<{ section: string; lang: Lang; state: ReleaseState; error: string | null }>(
    `select "section", "lang", "state", "error" from "release_run"
      where "teamId" = $1 and "kind" = 'delist' and "createdAt" >= $2 order by "createdAt"`,
    [run.teamId, since],
  );
  if (runs.some((each) => !isSettled(each.state))) return;
  const stop = (reason: string) => client.query(`update "team" set "deleteError" = $2 where "id" = $1`, [run.teamId, reason]);
  const failed = runs.find((each) => each.state === "failed");
  if (failed) {
    await stop(`Taking ${failed.section} in ${failed.lang} off the channel failed: ${failed.error ?? "no reason given"}`);
    return;
  }
  await client.query("savepoint team_delete");
  try {
    await finishDeletion(client, run.teamId, run.requestedBy);
    await client.query("release savepoint team_delete");
  } catch (error) {
    await client.query("rollback to savepoint team_delete");
    await stop(`Deleting its rows failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Deletes the team's rows, on the caller's transaction as ALL_TEAMS. Its text reports move to
 * another team of their language, else wait on the language's text queue under no team. Its voice
 * reports are about takes that go with it, so an open one is closed, and all of them keep no team.
 * A language it leaves with no team is switched off. Archive objects stay in their bucket; only
 * their rows go.
 */
export async function finishDeletion(client: PoolClient, team: TeamId, actorId: string | null): Promise<void> {
  const row = await teamRow(client, team, true);
  const { counts } = await countsOf(client, team);
  const members = await membersOf(client, team);
  const langs = await langsOf(client, team);
  await client.query(
    `with "moved" as (
       select r."id", (select tl."teamId" from "team_language" tl join "team" t on t."id" = tl."teamId"
                        where tl."lang" = r."lang" and tl."teamId" <> $1 and t."deletingAt" is null
                        order by ${TEAM_ORDER} limit 1) as "to"
         from "report" r where r."teamId" = $1 and r."queue" = 'text')
     update "report" r set "teamId" = m."to" from "moved" m where r."id" = m."id"`,
    [team],
  );
  // No column says why a report closed; the team.deleted row counts these.
  const { rowCount: closedReports } = await client.query(
    `update "report" set "status" = 'not_an_issue', "resolvedAt" = now(), "resolvedBy" = $2
      where "teamId" = $1 and "queue" = 'audio' and "status" = 'open'`,
    [team, actorId],
  );
  await client.query(`update "report" set "teamId" = null where "teamId" = $1 and "queue" = 'audio'`, [team]);
  await client.query(`update "release_run" set "promotes" = null where "teamId" = $1`, [team]);
  for (const table of DELETED) await client.query(`delete from "${table}" where "teamId" = $1`, [team]);
  // team_member, team_language and invite cascade; an approved request forgets the team.
  await client.query(`delete from "team" where "id" = $1`, [team]);
  const hidden: Lang[] = [];
  for (const { lang, alone } of langs) {
    if (alone && (await setEnabledOn(client, lang, false, actorId))) hidden.push(lang);
  }
  await recordActivity(
    {
      kind: "team.deleted",
      lang: null,
      actorId,
      subject: row.slug,
      detail: { slug: row.slug, members, langs: langs.map((each) => each.lang), counts, closedReports: closedReports ?? 0 },
    },
    client,
  );
  await recordActivities(
    hidden.map((lang) => ({ kind: "language.toggled" as const, lang, actorId, detail: { enabled: false }, team: null })),
    client,
  );
  // Every worker drops its team memo at commit.
  await client.query(`select pg_notify('spoken_team_language', '')`);
}
