/**
 * A site owner's review of a team's staged release, and delisting a team's pack
 * (docs/platform/TEAMS.md, *Releases*). Approving queues a `promote` run, which lists what the
 * release staged; its success makes the staged run `done` (store.ts). Rejecting settles it
 * `rejected` with the reason. Delisting queues a `delist` run, which takes the team's folders
 * out of both indexes. Each records activity under the run's team, and emails after the commit.
 */
import "server-only";

import type { PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, withTeam } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { runsOnDroplet } from "./droplet";
import { begin, failureOf } from "./launch";
import { tellPresser } from "./notify";
import { isReleaseSection, type ReleaseSection } from "./sections";
import { COLUMNS, insertRun, runById, type ReleaseRun } from "./store";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * English's Manager folders per section, which a team's pack carries with its language and slug.
 * scripts/lib/packs.mjs derivedFolders reads them from publishers/, which the server ships
 * without; review.test.ts checks the two agree.
 */
export const ENGLISH_FOLDERS: Record<ReleaseSection, readonly string[]> = {
  quests: ["SpokenQuestsAudioAlliance", "SpokenQuestsAudioHorde", "SpokenQuestsAudioShared", "SpokenQuestsAudioGossip"],
  places: ["SpokenPlacesAudio"],
  readables: ["SpokenReadablesAudio"],
  bosses: ["SpokenBossesAudio"],
};

/** A team's folders for a section and language: plain for the language's privileged team, else with its slug. */
export function teamFolders(section: ReleaseSection, lang: Lang, slug: string | null): string[] {
  if (lang === BASE_LANG && slug === null) return [...ENGLISH_FOLDERS[section]];
  return ENGLISH_FOLDERS[section].map((folder) => `${folder}_${lang}${slug === null ? "" : `_${slug}`}`);
}

async function waitingRun(client: PoolClient, runId: string): Promise<ReleaseRun> {
  const none = new ReviewError("No such release.", 404);
  if (!UUID.test(runId)) throw none;
  const { rows } = await client.query<ReleaseRun>(
    `select ${COLUMNS} from "release_run" where "id" = $1 and "kind" = 'release' for update`,
    [runId],
  );
  const run = rows[0];
  if (!run) throw none;
  if (run.state === "superseded") throw new ReviewError("A newer version of this pack replaced it; review that one.", 409);
  if (run.state !== "awaiting_review") throw new ReviewError("It is not waiting for review.", 409);
  return run;
}

/** Approves a staged version: its promotion waits its turn like any run, and lists it once it runs. */
export async function approve(runId: string, actorId: string): Promise<ReleaseRun> {
  if (!runsOnDroplet()) throw new ReviewError("Only the site that signs the channel can list a release.", 409);
  const promote = await withTeam(ALL_TEAMS, async (client) => {
    const run = await waitingRun(client, runId);
    const { rowCount: pending } = await client.query(
      `select 1 from "release_run" where "promotes" = $1 and "state" in ('queued', 'dispatching', 'running')`,
      [run.id],
    );
    if (pending) throw new ReviewError("It is approved already, and being listed.", 409);
    await client.query(
      `update "release_run" set "reviewedBy" = $2, "reviewedAt" = now(), "reviewNote" = null, "error" = null where "id" = $1`,
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
 * Takes a team's pack in one section and language off the channel. Every folder the team's pack
 * can have, not only those its last version changed: a quests release stages only the sides
 * that changed. An official team's pack is not delisted here; the release workflow is the way.
 */
export async function delistPack(teamId: string, lang: Lang, section: string, actorId: string): Promise<ReleaseRun> {
  if (!isReleaseSection(section)) throw new ReviewError("No such section.", 400);
  if (!UUID.test(teamId)) throw new ReviewError("No such team.", 404);
  if (!runsOnDroplet()) throw new ReviewError("Only the site that signs the channel can delist a pack.", 409);
  const run = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string; official: boolean; privileged: boolean | null }>(
      `select t."slug", t."official", tl."privileged"
         from "team" t left join "team_language" tl on tl."teamId" = t."id" and tl."lang" = $2
        where t."id" = $1`,
      [teamId, lang],
    );
    const team = rows[0];
    if (!team) throw new ReviewError("No such team.", 404);
    if (team.official) throw new ReviewError("An official team's packs are not delisted here.", 409);
    const folders = teamFolders(section, lang, team.privileged ? null : team.slug);
    const run = await insertRun(client, { kind: "delist", teamId, section, lang, requestedBy: actorId, staged: { folders } });
    await recordActivity(
      { kind: "release.delisted", lang, actorId, subject: run.id, detail: { section, folders }, team: teamId },
      client,
    );
    return run;
  });
  return started(run);
}
