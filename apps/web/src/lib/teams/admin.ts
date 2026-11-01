/**
 * Creating, renaming and handing languages to teams. The caller has checked the viewer may.
 */
import "server-only";

import { ALL_TEAMS, query, withTeam } from "@/lib/db";
import { recordActivity } from "@/lib/activity/store";
import type { Lang } from "@/lib/lang";
import type { Capability } from "@/lib/permissions";

import { forgetTeams, type TeamId } from "./store";

export type TeamSummary = {
  id: TeamId;
  slug: string;
  name: string;
  langs: Lang[];
  members: { userId: string; email: string; name: string | null; lang: Lang; capability: Capability }[];
};

/** A slug, an admin email or a hand-over the store refuses; the message is fit to show. */
export class TeamInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamInputError";
  }
}

/** A language with a running regeneration job cannot move: the job would commit under the old team. */
export class TeamBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamBusyError";
  }
}

/** The same shape the "team"."slug" check enforces. */
const SLUG = /^[a-z][a-z0-9-]{1,40}$/;

export async function listTeams(): Promise<TeamSummary[]> {
  const [teams, langs, members] = await Promise.all([
    query<{ id: TeamId; slug: string; name: string }>(`select "id", "slug", "name" from "team" order by "slug"`),
    query<{ teamId: TeamId; lang: Lang }>(
      `select "teamId", "lang" from "team_language" where "privileged" order by "lang"`,
    ),
    query<TeamSummary["members"][number] & { teamId: TeamId }>(
      `select m."teamId", m."userId", u."email", u."name", m."lang", m."capability"
         from "team_member" m join "user" u on u."id" = m."userId"
        order by u."email", m."lang", m."capability"`,
    ),
  ]);
  return teams.map((team) => ({
    ...team,
    langs: langs.filter((row) => row.teamId === team.id).map((row) => row.lang),
    members: members
      .filter((row) => row.teamId === team.id)
      .map(({ teamId: _team, ...member }) => member),
  }));
}

/**
 * Writes the team alone: membership is per language, so its first admin is granted once a
 * language is handed over. `adminEmail` is only checked here.
 */
export async function createTeam(
  input: { slug: string; name: string; adminEmail: string | null },
  actorId: string,
): Promise<TeamId> {
  if (!SLUG.test(input.slug)) {
    throw new TeamInputError("A team's slug is lowercase letters, digits and dashes, starting with a letter.");
  }
  const team = await withTeam(ALL_TEAMS, async (client) => {
    if (input.adminEmail !== null) {
      const user = await client.query(`select 1 from "user" where lower("email") = lower($1)`, [input.adminEmail]);
      if (!user.rowCount) throw new TeamInputError(`No user has the email ${input.adminEmail}.`);
    }
    const taken = await client.query(`select 1 from "team" where "slug" = $1`, [input.slug]);
    if (taken.rowCount) throw new TeamInputError(`A team is already called ${input.slug}.`);
    try {
      const { rows } = await client.query<{ id: TeamId }>(`select new_team($1, $2) as "id"`, [input.slug, input.name]);
      return rows[0].id;
    } catch (error) {
      // 23505 unique, 23514 check: a slug taken between the look and the insert.
      const code = (error as { code?: string }).code;
      if (code === "23505" || code === "23514") throw new TeamInputError(`The slug ${input.slug} is not available.`);
      throw error;
    }
  });
  await recordActivity({ kind: "team.created", lang: null, actorId, subject: input.slug, detail: { slug: input.slug } });
  return team;
}

export async function renameTeam(team: TeamId, name: string, actorId: string): Promise<void> {
  const slug = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string }>(
      `update "team" set "name" = $2 where "id" = $1 returning "slug"`,
      [team, name],
    );
    return rows[0]?.slug;
  });
  if (!slug) throw new TeamInputError("No such team.");
  await recordActivity({ kind: "team.renamed", lang: null, actorId, subject: slug, detail: { name } });
}

/** Hands `lang`, with every row of it, to `team`; returns the rows moved. */
export async function handOver(lang: Lang, team: TeamId, actorId: string): Promise<number> {
  let moved: { rows: number; from: string; to: string };
  try {
    moved = await withTeam(ALL_TEAMS, async (client) => {
      const { rows: slugs } = await client.query<{ from: string | null; to: string | null }>(
        `select (select "slug" from "team" where "id" = team_of_lang($1)) as "from",
                (select "slug" from "team" where "id" = $2) as "to"`,
        [lang, team],
      );
      const { rows } = await client.query<{ moved: number }>(`select move_team_lang($1, $2) as "moved"`, [lang, team]);
      return { rows: rows[0].moved, from: slugs[0].from ?? "", to: slugs[0].to ?? "" };
    });
  } catch (error) {
    // move_team_lang raises with a message for each refusal; P0001 is a plain `raise exception`.
    if ((error as { code?: string }).code !== "P0001") throw error;
    const message = (error as Error).message;
    throw /running regeneration job/.test(message) ? new TeamBusyError(message) : new TeamInputError(message);
  }
  // Before the log row, which takes its team from the memo: it belongs to the new owner.
  forgetTeams();
  await recordActivity({
    kind: "team.language_moved",
    lang,
    actorId,
    subject: moved.to,
    detail: { from: moved.from, to: moved.to },
  });
  return moved.rows;
}
