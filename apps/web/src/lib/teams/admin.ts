/** Team writes. Nothing here checks the viewer; the caller has. */
import "server-only";

import { ALL_TEAMS, query, queryIn, withTeam } from "@/lib/db";
import { recordActivity } from "@/lib/activity/store";
import { addGrants, userByEmail } from "@/lib/grants/store";
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

/**
 * A refusal whose message is fit to show: 409 for a language with a running job, which would
 * commit under the old team, 400 for anything else.
 */
export class TeamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

/** The same shape the "team"."slug" check enforces. */
const SLUG = /^[a-z][a-z0-9-]{1,40}$/;

export async function listTeams(only?: TeamId): Promise<TeamSummary[]> {
  const id = [only ?? null];
  const [teams, langs, members] = await Promise.all([
    query<{ id: TeamId; slug: string; name: string }>(
      `select "id", "slug", "name" from "team" where $1::uuid is null or "id" = $1 order by "slug"`,
      id,
    ),
    query<{ teamId: TeamId; lang: Lang }>(
      `select "teamId", "lang" from "team_language"
        where "privileged" and ($1::uuid is null or "teamId" = $1) order by "lang"`,
      id,
    ),
    query<TeamSummary["members"][number] & { teamId: TeamId }>(
      `select m."teamId", m."userId", u."email", u."name", m."lang", m."capability"
         from "team_member" m join "user" u on u."id" = m."userId"
        where $1::uuid is null or m."teamId" = $1
        order by u."email", m."lang", m."capability"`,
      id,
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
 * Writes the team alone: membership is per language, so the admin is granted once a language
 * is handed over, and only their id is returned.
 */
export async function createTeam(
  input: { slug: string; name: string; adminEmail: string | null },
  actorId: string,
): Promise<{ id: TeamId; adminId: string | null }> {
  if (!SLUG.test(input.slug)) {
    throw new TeamError("A team's slug is lowercase letters, digits and dashes, starting with a letter.");
  }
  let adminId: string | null = null;
  if (input.adminEmail !== null) {
    const admin = await userByEmail(input.adminEmail);
    if (!admin) throw new TeamError(`No user has the email ${input.adminEmail}.`);
    adminId = admin.id;
  }
  const id = await withTeam(ALL_TEAMS, async (client) => {
    try {
      const { rows } = await client.query<{ id: TeamId }>(`select new_team($1, $2) as "id"`, [input.slug, input.name]);
      return rows[0].id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new TeamError(`A team is already called ${input.slug}.`);
      throw error;
    }
  });
  await recordActivity({ kind: "team.created", lang: null, actorId, subject: input.slug, detail: { slug: input.slug } });
  return { id, adminId };
}

/** A refusal part way keeps the team and what already moved, so its message says what did. */
export async function createTeamWithLangs(
  input: { slug: string; name: string; adminEmail: string | null; langs: readonly Lang[] },
  actorId: string,
): Promise<{ team: TeamSummary; moved: Lang[] }> {
  const { id, adminId } = await createTeam(input, actorId);
  const moved: Lang[] = [];
  for (const lang of input.langs) {
    try {
      await handOver(lang, id, actorId);
    } catch (error) {
      if (!(error instanceof TeamError)) throw error;
      const done = moved.length ? `moved ${moved.join(", ")}; ` : "";
      throw new TeamError(`${done}${lang} refused: ${error.message}`, error.status);
    }
    moved.push(lang);
    if (adminId) await addGrants(adminId, lang, ["admin"], actorId);
  }
  const [team] = await listTeams(id);
  return { team, moved };
}

export async function renameTeam(team: TeamId, name: string, actorId: string): Promise<void> {
  const slug = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string }>(
      `update "team" set "name" = $2 where "id" = $1 returning "slug"`,
      [team, name],
    );
    return rows[0]?.slug;
  });
  if (!slug) throw new TeamError("No such team.");
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
    // 55006 is a running job; P0001 is any other refusal of move_team_lang.
    const code = (error as { code?: string }).code;
    if (code === "55006") throw new TeamError((error as Error).message, 409);
    if (code === "P0001") throw new TeamError((error as Error).message);
    throw error;
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

/** Live takes per language, which a hand-over moves too. */
export async function liveTakeCounts(): Promise<Map<Lang, number>> {
  const rows = await queryIn<{ lang: Lang; count: number }>(
    ALL_TEAMS,
    `select "lang", count(*)::int as "count" from "take" where "isCurrent" group by "lang"`,
  );
  return new Map(rows.map((row) => [row.lang, row.count]));
}
