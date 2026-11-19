/**
 * Deleting a team (docs/platform/TEAMS.md, *Deleting a team*). What would go, for the dialog that
 * asks for the team's slug.
 */
import "server-only";

import type { ClientBase } from "pg";

import { ALL_TEAMS, withTeam } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { Capability } from "@/lib/permissions";
import type { ReleaseSection } from "@/lib/releases/sections";

import { TeamError } from "./admin";
import { membersOf } from "./members";
import type { TeamId } from "./store";

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
  /** Its rows in each table that goes with it, and its reports, which move. */
  counts: Record<DeletedTable | "report", number>;
  /** Generation that has not started, which is cancelled. */
  pending: number;
  packs: LivePack[];
  /** Why it cannot be deleted now; null when it can. */
  refusal: string | null;
};

/** Its packs on the channel, from its releases: a release made before the site ran them has no row. */
export async function livePacks(client: ClientBase, team: TeamId): Promise<LivePack[]> {
  const { rows } = await client.query<LivePack>(
    `select live."lang", live."section", live."version" from (
       select distinct on ("lang", "section") "lang", "section", "version", coalesce("finishedAt", "createdAt") as "at"
         from "release_run" where "teamId" = $1 and "kind" = 'release' and "state" = 'done'
        order by "lang", "section", "createdAt" desc
     ) live
     where not exists (select 1 from "release_run" d
                        where d."kind" = 'delist' and d."state" = 'done' and d."teamId" = $1
                          and d."lang" = live."lang" and d."section" = live."section"
                          and coalesce(d."finishedAt", d."createdAt") > live."at")
     order by live."lang", live."section"`,
    [team],
  );
  return rows;
}

/** Why `team` cannot be deleted now, or null. On the caller's client, as ALL_TEAMS. */
export async function refusalOf(
  client: ClientBase,
  team: { id: TeamId; slug: string; deletingAt: Date | null },
): Promise<string | null> {
  if (team.deletingAt) return `${team.slug} is being deleted already.`;
  const { rowCount: english } = await client.query(
    `select 1 from "team_language" where "teamId" = $1 and "lang" = $2`,
    [team.id, BASE_LANG],
  );
  if (english) return "English's team cannot be deleted: every other language is built from it.";
  const { rowCount: busy } = await client.query(
    `select 1 from "release_run" where "teamId" = $1 and "state" in ('queued', 'dispatching', 'running', 'approved')`,
    [team.id],
  );
  if (busy) return `${team.slug} has a release under way; delete it once that is finished.`;
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

async function countsOf(client: ClientBase, team: TeamId): Promise<DeletionPreview["counts"]> {
  const tables = [...DELETED, "report"] as const;
  const { rows } = await client.query<Record<string, string>>(
    `select ${tables.map((table) => `(select count(*) from "${table}" where "teamId" = $1) as "${table}"`).join(", ")}`,
    [team],
  );
  return Object.fromEntries(tables.map((table) => [table, Number(rows[0][table])])) as DeletionPreview["counts"];
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
    const langs = await langsOf(client, team);
    const { rows: pending } = await client.query<{ count: string }>(
      `select count(*) as "count" from "regeneration_job" where "teamId" = $1 and "state" = 'pending'`,
      [team],
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      langs,
      members: await membersOf(client, team),
      counts: await countsOf(client, team),
      pending: Number(pending[0].count),
      packs: await livePacks(client, team),
      refusal: await refusalOf(client, row),
    };
  });
}
