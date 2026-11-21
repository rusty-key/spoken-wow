/** Team writes. Nothing here checks the viewer; the caller has. */
import "server-only";

import type { ClientBase } from "pg";

import { ALL_TEAMS, query, queryIn, withTeam } from "@/lib/db";
import type { ActivityDetail } from "@/lib/activity/kinds";
import { recordActivities, recordActivity, type ActivityEvent } from "@/lib/activity/store";
import { addGrants, OtherTeamError, userByEmail } from "@/lib/grants/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { setEnabledOn } from "@/lib/languages/store";
import type { Capability } from "@/lib/permissions";

import type { Settings } from "./found";

import { isSlug } from "./slug";
import { forgetTeams, TEAM_ORDER, type TeamId } from "./store";

export type TeamSummary = {
  id: TeamId;
  slug: string;
  name: string;
  /** New audio goes only to its own bucket; what our archive holds stays (docs/platform/STORAGE.md). */
  ownStorage: boolean;
  /** Its releases need no review and its packs carry no team label (docs/platform/TEAMS.md). */
  official: boolean;
  /** The languages it voices, beside any other team of each. */
  langs: Lang[];
  members: { userId: string; email: string; name: string | null; lang: Lang; capability: Capability }[];
  /** While it is being deleted (delete.ts): how far its delistings are, and why it stopped if it did. */
  deleting: { delisted: number; delists: number; error: string | null } | null;
};

/**
 * A refusal whose message is fit to show: 409 for a conflict with what exists (a language with a
 * running job, which would commit under the old team; a taken name), 404 for something missing,
 * 400 for anything else.
 */
export class TeamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

export function checkSlug(slug: string): void {
  if (!isSlug(slug)) throw new TeamError("A team's slug is lowercase letters, digits and dashes, starting with a letter.");
}

export async function listTeams(only?: TeamId): Promise<TeamSummary[]> {
  const id = [only ?? null];
  const [teams, langs, members] = await Promise.all([
    // Across teams: a team's runs are its own (row-level security).
    queryIn<{
      id: TeamId; slug: string; name: string; ownStorage: boolean; official: boolean;
      deletingAt: Date | null; deleteError: string | null; delisted: number; delists: number;
    }>(
      ALL_TEAMS,
      `select t."id", t."slug", t."name", t."ownStorage", t."official", t."deletingAt", t."deleteError",
              d."delisted", d."delists"
         from "team" t
         left join lateral (
           select (count(*) filter (where r."state" in ('done', 'unchanged')))::int as "delisted", count(*)::int as "delists"
             from "release_run" r
            where r."teamId" = t."id" and r."kind" = 'delist' and r."createdAt" >= t."deletingAt") d on true
        where $1::uuid is null or t."id" = $1 order by t."slug"`,
      id,
    ),
    query<{ teamId: TeamId; lang: Lang }>(
      `select "teamId", "lang" from "team_language"
        where $1::uuid is null or "teamId" = $1 order by "lang"`,
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
  return teams.map(({ deletingAt, deleteError, delisted, delists, ...team }) => ({
    ...team,
    deleting: deletingAt ? { delisted, delists, error: deleteError } : null,
    langs: langs.filter((row) => row.teamId === team.id).map((row) => row.lang),
    members: members
      .filter((row) => row.teamId === team.id)
      .map(({ teamId: _team, ...member }) => member),
  }));
}

/** The id of the user `adminEmail` names, null for none; a TeamError when nobody has it. */
export async function resolveAdmin(adminEmail: string | null): Promise<string | null> {
  if (adminEmail === null) return null;
  const admin = await userByEmail(adminEmail);
  if (!admin) throw new TeamError(`No user has the email ${adminEmail}.`);
  return admin.id;
}

/**
 * Writes the team alone: membership is per language, so the admin is granted once the team joins
 * a language, and only their id is returned.
 */
export async function createTeam(
  input: { slug: string; name: string; adminEmail: string | null },
  actorId: string,
): Promise<{ id: TeamId; adminId: string | null }> {
  checkSlug(input.slug);
  const adminId = await resolveAdmin(input.adminEmail);
  const id = await withTeam(ALL_TEAMS, async (client) => {
    try {
      const { rows } = await client.query<{ id: TeamId }>(`select new_team($1, $2) as "id"`, [input.slug, input.name]);
      // Its audio goes to its own bucket, never our archive, unless a site admin lifts that. A site
      // owner made it, so it is official.
      await client.query(`update "team" set "ownStorage" = true, "official" = true where "id" = $1`, [rows[0].id]);
      return rows[0].id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new TeamError(`A team is already called ${input.slug}.`);
      throw error;
    }
  });
  await recordActivity({ kind: "team.created", lang: null, actorId, subject: input.slug, detail: { slug: input.slug } });
  return { id, adminId };
}

/** A refusal part way keeps the team and the languages it already joined, so its message says which. */
export async function createTeamWithLangs(
  input: { slug: string; name: string; adminEmail: string | null; langs: readonly Lang[] },
  actorId: string,
): Promise<{ team: TeamSummary; joined: Lang[] }> {
  const { id, adminId } = await createTeam(input, actorId);
  const joined: Lang[] = [];
  for (const lang of input.langs) {
    try {
      await addToLanguage(lang, id, actorId);
    } catch (error) {
      if (!(error instanceof TeamError)) throw error;
      const done = joined.length ? `joined ${joined.join(", ")}; ` : "";
      throw new TeamError(`${done}${lang} refused: ${error.message}`, error.status);
    }
    joined.push(lang);
    if (!adminId) continue;
    try {
      await addGrants(adminId, lang, ["admin"], actorId, { team: id });
    } catch (error) {
      if (error instanceof OtherTeamError) {
        throw new TeamError(`joined ${joined.join(", ")}; ${error.message}`, 409);
      }
      throw error;
    }
  }
  const [team] = await listTeams(id);
  return { team, joined };
}

// A team's flags a site owner sets, each logged under its own kind with the flag as its detail.
const FLAG_KINDS = { ownStorage: "team.own_storage", official: "team.official" } as const;

async function setFlag(team: TeamId, flag: keyof typeof FLAG_KINDS, value: boolean, actorId: string): Promise<void> {
  const slug = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string }>(
      `update "team" set "${flag}" = $2 where "id" = $1 returning "slug"`,
      [team, value],
    );
    if (rows.length === 0) throw new TeamError("No such team.", 404);
    return rows[0].slug;
  });
  const kind = FLAG_KINDS[flag];
  await recordActivity({ kind, lang: null, actorId, subject: slug, detail: { [flag]: value } as ActivityDetail[typeof kind] });
}

/** Whether the team may use our archive. Its buckets and what is already kept stay as they are. */
export async function setOwnStorage(team: TeamId, ownStorage: boolean, actorId: string): Promise<void> {
  await setFlag(team, "ownStorage", ownStorage, actorId);
}

/** Whether the team's releases skip review and its packs go unlabelled. */
export async function setOfficial(team: TeamId, official: boolean, actorId: string): Promise<void> {
  await setFlag(team, "official", official, actorId);
}

export async function renameTeam(team: TeamId, name: string, actorId: string): Promise<void> {
  const slug = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string }>(
      `update "team" set "name" = $2 where "id" = $1 returning "slug"`,
      [team, name],
    );
    // The team memo holds names: every worker drops it at commit.
    await client.query(`select pg_notify('spoken_team_language', '')`);
    return rows[0]?.slug;
  });
  if (!slug) throw new TeamError("No such team.");
  forgetTeams();
  await recordActivity({ kind: "team.renamed", lang: null, actorId, subject: slug, detail: { name } });
}

/** `team` joins `lang` beside its other teams, as joinLanguage, and the log says so. */
export async function addToLanguage(lang: Lang, team: TeamId, actorId: string): Promise<void> {
  const joined = await withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]);
    if (rows.length === 0) throw new TeamError("No such team.", 404);
    return { slug: rows[0].slug, ...(await joinLanguage(client, lang, team, actorId)) };
  });
  forgetTeams();
  await recordActivities(joinEvents(lang, actorId, { team: { id: team, slug: joined.slug }, from: joined.from }, joined.switchedOn));
}

/**
 * The log of a join: `joined.team` voices `lang` now, unless the language's first team came with
 * it (null), and the language was switched on, when it was.
 */
export function joinEvents(
  lang: Lang,
  actorId: string,
  joined: { team: { id: TeamId; slug: string }; from: string | null } | null,
  switchedOn: boolean,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  if (joined) {
    const { team, from } = joined;
    events.push({ kind: "team.joined_language", lang, actorId, subject: team.slug, detail: { slug: team.slug, from }, team: team.id });
  }
  if (switchedOn) events.push({ kind: "language.toggled", lang, actorId, detail: { enabled: true } });
  return events;
}

/**
 * `team` voices `lang` beside every team that already does. Its packs are plain where its slug is
 * the language's code and no team has plain packs, else carry its slug (the insert trigger, 0123).
 * `copy` starts it from `source`'s roster, model settings and lexicon entries in the language,
 * else the first team's; anything else, or a language with no team, from English's roster. A
 * `source` that no longer voices the language is refused: the team it would copy is not the one
 * the caller showed. Nothing is copied
 * that a team voiced: the team starts from scratch. A language with no team is switched on.
 *
 * On the caller's client, which acts as ALL_TEAMS; the caller forgets the memo once it commits.
 */
export async function joinLanguage(
  client: ClientBase,
  lang: string,
  team: TeamId,
  actorId: string,
  settings: Settings = "fresh",
  source?: TeamId,
): Promise<{ first: boolean; from: string | null; switchedOn: boolean }> {
  if (lang === BASE_LANG) throw new TeamError("English is one team; no other team can join it.");
  const { rows: teams } = await client.query<{ teamId: TeamId; slug: string }>(
    `select tl."teamId", t."slug" from "team_language" tl join "team" t on t."id" = tl."teamId"
      where tl."lang" = $1
      order by ${TEAM_ORDER}`,
    [lang],
  );
  if (teams.some((row) => row.teamId === team)) throw new TeamError(`That team already voices ${lang}.`, 409);
  const from = settings === "copy" ? ((source ? teams.find((row) => row.teamId === source) : teams[0]) ?? null) : null;
  if (settings === "copy" && source && !from) {
    throw new TeamError(`The team to start from no longer voices ${lang}; reload and choose again.`, 409);
  }
  await client.query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [team, lang]);
  // Every worker drops its team memo at commit; until then the others file a new member's work
  // under no team.
  await client.query(`select pg_notify('spoken_team_language', $1)`, [lang]);
  if (from) {
    await client.query(`select copy_team_settings($1, $2, $3)`, [from.teamId, team, lang]);
  } else {
    await client.query(`select copy_team_roster((select "id" from "team" where "slug" = 'english'), $1)`, [team]);
  }
  const first = teams.length === 0;
  const switchedOn = first && !(await setEnabledOn(client, lang, true, actorId));
  return { first, from: from?.slug ?? null, switchedOn };
}

