/**
 * The one step that founds a team in a language, run by a request's approval and by the New team
 * form. It picks its branch from the language's state when it runs, not when it was asked for
 * (SELF-SERVE-TEAMS.md, *What approval does*):
 *
 * - a code with no `language` row is created, switched on, with the new team voicing it;
 * - a known language gets the new team beside any it has, all of them equal. One with no team
 *   is switched on.
 *
 * A language's first team gets `text` for the team (`textByTeam`) and `admin` and `text` for its
 * admin; a team beside others gets `admin` alone, the text staying with whoever keeps it.
 * Everything is written on the caller's client, in its transaction; afterFounded logs it once
 * that commits.
 */
import "server-only";

import type { ClientBase, PoolClient } from "pg";

import { recordActivities, type ActivityEvent } from "@/lib/activity/store";
import { ALL_TEAMS, actAs, db } from "@/lib/db";
import { grantOn, oneTeamPerLanguage } from "@/lib/grants/store";
import { BASE_LANG } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew, giveTextToTeam, LanguageExistsError, setEnabledOn } from "@/lib/languages/store";
import type { Capability } from "@/lib/permissions";

import { teamIn } from "./acting";
import { checkSlug, joinEvents, joinLanguage, TeamError } from "./admin";
import { forgetTeams, type TeamId } from "./store";

export type Branch = "new-language" | "add-team";

/** What a team joining a language that has teams starts from: the first one's voices and settings, or English's voices alone. */
export type Settings = "copy" | "fresh";

export type FoundInput = {
  lang: string;
  /** English and native names, used only when the code is new. */
  language: { name: string; native: string } | null;
  /** A null slug is derived from the name. */
  team: { slug: string | null; name: string };
  adminId: string | null;
  /** For a language that has a team already; fresh when absent. */
  settings?: Settings;
  /** A site owner's team is official; a request's is not (docs/platform/TEAMS.md, *Releases*). */
  official: boolean;
};

export type Founded = {
  branch: Branch;
  teamId: TeamId;
  slug: string;
  lang: string;
  /** The slug of the team whose voices and settings it started from; null for none. */
  from: string | null;
  switchedOn: boolean;
  adminId: string | null;
  granted: Capability[];
  /** The English name of a language this created. */
  languageName: string | null;
  /** What it started from, where the language had a team; null where it had none. */
  settings: Settings | null;
};

/**
 * The slug check allows 41 characters, and free_team_slug appends `-N` to a taken slug without
 * shortening it: 37 leaves room for `-999`.
 */
const SLUG_MAX = 37;

/**
 * The refusal of a requester who already works on `lang` in a team, which founding them a team
 * there could only break; null when they work on it in none.
 */
export async function memberRefusal(
  userId: string,
  lang: string,
  client?: Pick<ClientBase, "query">,
): Promise<TeamError | null> {
  const team = await teamIn(userId, lang, client);
  if (!team) return null;
  const { rows } = await (client ?? db()).query<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]);
  return new TeamError(oneTeamPerLanguage("You already work", lang, rows[0].slug), 409);
}

export async function languageBranch(lang: string, client?: ClientBase): Promise<Branch> {
  const { rows } = await (client ?? db()).query(`select 1 from "language" where "code" = $1`, [lang]);
  return rows.length ? "add-team" : "new-language";
}

/**
 * The slug a team name asks for, before free_team_slug makes it unique: lowercase, every run of
 * anything but a-z and digits a dash. A name that leaves too little, or no leading letter, falls
 * back to the code.
 */
export function slugFor(teamName: string, lang: string): string {
  const slug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug.length >= 2 && /^[a-z]/.test(slug) ? slug : lang.toLowerCase();
}

/**
 * Acts as ALL_TEAMS for the rest of the transaction: copy_team_roster is security invoker, and
 * every team's rows are written. The language row is locked first, so two foundings of one known
 * language run one after the other and the second sees the first's team.
 */
export async function foundTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  await actAs(client, ALL_TEAMS);
  if (input.lang === BASE_LANG) throw new TeamError("English is one team; no other team can join it.");
  if (input.team.slug !== null) checkSlug(input.team.slug);
  await client.query(`select 1 from "language" where "code" = $1 for update`, [input.lang]);
  const founded =
    (await languageBranch(input.lang, client)) === "new-language"
      ? await foundLanguage(client, input, actorId)
      : await addTeam(client, input, actorId);
  // A team a person founds keeps its new audio in its own bucket (docs/platform/STORAGE.md); a site
  // admin can lift that on /admin/teams. After both branches, since a new language's team is
  // found_lang_team's, which has the default false.
  await client.query(`update "team" set "ownStorage" = true, "official" = $2 where "id" = $1`, [
    founded.teamId,
    input.official,
  ]);
  return founded;
}

/** A new code: the language, switched on, and the team addLanguage made for it, renamed as asked. */
async function foundLanguage(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  if (!input.language) throw new TeamError(`${input.lang} is a new language: it needs an English and a native name.`);
  try {
    await addLanguage(client, describeNew(input.lang, input.language.name, input.language.native), actorId);
  } catch (error) {
    if (error instanceof LanguageExistsError) throw new TeamError(error.message, 409);
    throw error;
  }
  const team = await renameAdopted(client, input);
  const switchedOn = !(await setEnabledOn(client, input.lang, true, actorId));
  return {
    ...(await firstTeamGrants(client, input, actorId, team.id)),
    branch: "new-language",
    teamId: team.id,
    slug: team.slug,
    lang: input.lang,
    from: null,
    switchedOn,
    languageName: input.language.name,
    settings: null,
  };
}

/**
 * found_lang_team's team, slugged by the code, renamed as asked; a name that falls back to the code
 * keeps its slug. Its packs stay plain, as a new language's first team's always were.
 */
async function renameAdopted(client: PoolClient, input: FoundInput): Promise<{ id: TeamId; slug: string }> {
  const base = slugFor(input.team.name, input.lang);
  const [team] = await named(
    client,
    input.team.slug ?? base,
    `update "team"
        set "slug" = coalesce($1, case when "slug" = $2 then "slug" else free_team_slug($2) end), "name" = $3
      where "id" = (select "teamId" from "team_language" where "lang" = $4)
      returning "id", "slug"`,
    [input.team.slug, base, input.team.name, input.lang],
  );
  return team;
}

/** A known language: a new team beside any it has, equal to them. */
async function addTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  const { lang, adminId } = input;
  if (adminId) {
    const refusal = await memberRefusal(adminId, lang, client);
    if (refusal) throw refusal;
  }
  const team = await newTeam(client, input);
  const joined = await joinLanguage(client, lang, team.id, actorId, input.settings);
  const granted = joined.first
    ? await firstTeamGrants(client, input, actorId, team.id)
    : { adminId, granted: adminId ? await grantOn(client, team.id, adminId, lang, ["admin"], actorId) : [] };
  return {
    ...granted,
    branch: "add-team",
    teamId: team.id,
    slug: team.slug,
    lang,
    from: joined.from,
    switchedOn: joined.switchedOn,
    languageName: null,
    settings: joined.first ? null : (input.settings ?? "fresh"),
  };
}

/** A new team with no language yet, slugged as asked or from its name. */
async function newTeam(client: PoolClient, input: FoundInput): Promise<{ id: TeamId; slug: string }> {
  const slug =
    input.team.slug ??
    (await client.query<{ slug: string }>(`select free_team_slug($1) as "slug"`, [slugFor(input.team.name, input.lang)]))
      .rows[0].slug;
  const [team] = await named(client, slug, `select new_team($1, $2) as "id", $1::text as "slug"`, [slug, input.team.name]);
  return team;
}

/** Writes the team, mapping a taken explicit slug to a refusal. */
async function named(
  client: PoolClient,
  slug: string | null,
  text: string,
  params: unknown[],
): Promise<{ id: TeamId; slug: string }[]> {
  try {
    return (await client.query<{ id: TeamId; slug: string }>(text, params)).rows;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new TeamError(`A team is already called ${slug}.`, 409);
    throw error;
  }
}

/** A language's first team: `text` given to its teams, its admin granted `admin` and `text`. */
async function firstTeamGrants(
  client: PoolClient,
  input: FoundInput,
  actorId: string,
  team: TeamId,
): Promise<Pick<Founded, "adminId" | "granted">> {
  await giveTextToTeam(client, input.lang);
  const granted = input.adminId ? await grantOn(client, team, input.adminId, input.lang, ["admin", "text"], actorId) : [];
  return { adminId: input.adminId, granted };
}

/**
 * After the founding commits: the memos first, so the registry knows a new language and each log
 * row files under the new team, then the log.
 */
export async function afterFounded(founded: Founded, actorId: string): Promise<void> {
  forgetLanguages();
  forgetTeams();
  // Loaded now rather than on the next request, so this process's isLang knows the language at once.
  await loadLanguages().catch((error) => console.error("could not reload languages:", error));
  const { lang, slug } = founded;
  const events: ActivityEvent[] = [
    {
      kind: "team.created",
      lang: null,
      actorId,
      subject: slug,
      detail: { slug },
      // A team beside others is filed in its own log, so in its language, which a filed row must
      // name; the language's other teams do not see it.
      ...(founded.branch === "add-team" ? { lang, team: founded.teamId } : {}),
    },
  ];
  if (founded.branch === "new-language") {
    events.push({ kind: "language.added", lang, actorId, detail: { name: founded.languageName ?? lang } });
  }
  const joined = founded.branch === "add-team" ? { team: { id: founded.teamId, slug }, from: founded.from } : null;
  events.push(...joinEvents(lang, actorId, joined, founded.switchedOn));
  for (const capability of founded.granted) {
    events.push({
      kind: "grant.added",
      lang,
      subject: founded.adminId,
      actorId,
      detail: { capability },
      team: founded.teamId,
    });
  }
  await recordActivities(events);
}
