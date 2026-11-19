/**
 * The one step that founds a team in a language, run by a request's approval and by the New team
 * form. It picks its branch from the language's state when it runs, not when it was asked for
 * (SELF-SERVE-TEAMS.md, *What approval does*):
 *
 * - a code with no `language` row is created, switched on, with the new team owning it;
 * - a known language nobody looks after is handed over to a new team and switched on;
 * - a language somebody looks after gets a second team beside its privileged one.
 *
 * The first two give `text` to the team (`textByTeam`) and `admin` and `text` to its admin; a
 * second team's admin gets `admin` alone. Everything is written on the caller's client, in its
 * transaction; afterFounded logs it once that commits.
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
import { checkSlug, moveLang, TeamError } from "./admin";
import { forgetTeams, foundLangTeam, type TeamId } from "./store";

export type Branch = "new-language" | "hand-over" | "second-team";

/** What a second team starts from: the privileged team's voices and settings, or English's voices alone. */
export type Settings = "copy" | "fresh";

export type FoundInput = {
  lang: string;
  /** English and native names, used only when the code is new. */
  language: { name: string; native: string } | null;
  /** A null slug is derived from the name. */
  team: { slug: string | null; name: string };
  adminId: string | null;
  /** For a second team only; fresh when absent. */
  settings?: Settings;
  /** A site owner's team is official; a request's is not (docs/platform/TEAMS.md, *Releases*). */
  official: boolean;
};

export type Founded = {
  branch: Branch;
  teamId: TeamId;
  slug: string;
  lang: string;
  /** The slug of the team the language was handed over from, or that a second team sits beside. */
  from: string | null;
  moved: number;
  switchedOn: boolean;
  adminId: string | null;
  granted: Capability[];
  /** The English name of a language this created. */
  languageName: string | null;
  /** What a second team started from; null on the other branches. */
  settings: Settings | null;
};

/**
 * The slug check allows 41 characters, and free_team_slug appends `-N` to a taken slug without
 * shortening it: 37 leaves room for `-999`.
 */
const SLUG_MAX = 37;

/**
 * The language's privileged team when somebody looks after it: a member of that team in this
 * language, or a text maintainer, who is not a site owner. A site owner's grants do not count:
 * they hold them to keep a language running, not to keep it. Read on the caller's client when
 * given, so it sees that transaction's writes.
 */
async function activeTeamOf(lang: string, client?: ClientBase): Promise<TeamId | null> {
  const { rows } = await (client ?? db()).query<{ teamId: TeamId }>(
    `select tl."teamId" from "team_language" tl
      where tl."lang" = $1 and tl."privileged"
        and (exists (select 1 from "team_member" m join "user" u on u."id" = m."userId"
                      where m."teamId" = tl."teamId" and m."lang" = $1 and u."role" is distinct from 'admin')
          or exists (select 1 from "language_grant" g join "user" u on u."id" = g."userId"
                      where g."lang" = $1 and u."role" is distinct from 'admin'))`,
    [lang],
  );
  return rows[0]?.teamId ?? null;
}

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
  if (!rows.length) return "new-language";
  return (await activeTeamOf(lang, client)) ? "second-team" : "hand-over";
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
 * Acts as ALL_TEAMS for the rest of the transaction: move_team_lang and copy_team_roster are
 * security invoker, and every team's rows are written. The language row is locked first, so two
 * foundings of one known language run one after the other and the second sees the first's team.
 */
export async function foundTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  await actAs(client, ALL_TEAMS);
  if (input.lang === BASE_LANG) throw new TeamError("English is one team; no other team can take it.");
  if (input.team.slug !== null) checkSlug(input.team.slug);
  await client.query(`select 1 from "language" where "code" = $1 for update`, [input.lang]);
  const founded = await (async () => {
    switch (await languageBranch(input.lang, client)) {
      case "new-language":
        return foundLanguage(client, input, actorId);
      case "hand-over":
        return takeOverLanguage(client, input, actorId);
      case "second-team":
        return addSecondTeam(client, input, actorId);
    }
  })();
  // A team a person founds keeps its new audio in its own bucket (docs/platform/STORAGE.md); a site
  // admin can lift that on /admin/teams. After every branch, since a hand-over can claim the team
  // found_lang_team made, which has the default false.
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
  return {
    ...(await hand(client, input, actorId, team.id)),
    branch: "new-language",
    teamId: team.id,
    slug: team.slug,
    lang: input.lang,
    from: null,
    moved: 0,
    languageName: input.language.name,
    settings: null,
  };
}

/**
 * A known language nobody looks after: a new team, which the language moves to with its rows. A
 * language with a row but no team yet gets found_lang_team's team, with english's roster, renamed.
 */
async function takeOverLanguage(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  const { rows } = await client.query<{ team: TeamId | null }>(`select team_of_lang($1) as "team"`, [input.lang]);
  let team: { id: TeamId; slug: string };
  let moved = 0;
  let from: string | null = null;
  if (rows[0].team === null) {
    await foundLangTeam(client, input.lang);
    team = await renameAdopted(client, input);
  } else {
    team = await newTeam(client, input);
    ({ moved, from } = await moveLang(client, input.lang, team.id));
  }
  return {
    ...(await hand(client, input, actorId, team.id)),
    branch: "hand-over",
    teamId: team.id,
    slug: team.slug,
    lang: input.lang,
    from,
    moved,
    languageName: null,
    settings: null,
  };
}

/** found_lang_team's team, slugged by the code, renamed as asked; a name that falls back to the code keeps its slug. */
async function renameAdopted(client: PoolClient, input: FoundInput): Promise<{ id: TeamId; slug: string }> {
  const base = slugFor(input.team.name, input.lang);
  const [team] = await named(
    client,
    input.team.slug ?? base,
    `update "team"
        set "slug" = coalesce($1, case when "slug" = $2 then "slug" else free_team_slug($2) end), "name" = $3
      where "id" = team_of_lang($4)
      returning "id", "slug"`,
    [input.team.slug, base, input.team.name, input.lang],
  );
  return team;
}

/**
 * A language somebody already looks after gets a second team beside its privileged one: the
 * third row of SELF-SERVE-TEAMS.md *What approval does* ("Known, with an active team"). The
 * language stays the privileged team's, switched on or off as it was, and its text stays with
 * the maintainers the site owner appoints, so the admin gets `admin` alone.
 *
 * `copy` starts the team from the privileged team's roster, model settings and lexicon entries in
 * the language; `fresh` from English's roster. Neither copies a take, recording or line override:
 * the new team voices the language from scratch.
 *
 * The notify reaches every worker's team memo at commit; without it the others would file a new
 * member's work under the privileged team until the memo expires.
 */
export async function addSecondTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  const { lang, adminId } = input;
  const settings = input.settings ?? "fresh";
  if (adminId) {
    const refusal = await memberRefusal(adminId, lang, client);
    if (refusal) throw refusal;
  }
  const team = await newTeam(client, input);
  await client.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, false)`, [team.id, lang]);
  await client.query(`select pg_notify('spoken_team_language', $1)`, [lang]);
  const { rows } = await client.query<{ id: TeamId; slug: string }>(
    `select "id", "slug" from "team" where "id" = team_of_lang($1)`,
    [lang],
  );
  const beside = rows[0];
  if (settings === "copy") {
    await client.query(`select copy_team_settings($1, $2, $3)`, [beside.id, team.id, lang]);
  } else {
    await client.query(`select copy_team_roster((select "id" from "team" where "slug" = 'english'), $1)`, [team.id]);
  }
  const granted = adminId ? await grantOn(client, team.id, adminId, lang, ["admin"], actorId) : [];
  return {
    branch: "second-team",
    teamId: team.id,
    slug: team.slug,
    lang,
    from: beside.slug,
    moved: 0,
    switchedOn: false,
    adminId,
    granted,
    languageName: null,
    settings,
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

/** What a new language and a hand-over end with: the language switched on, `text` given to its team, the admin granted. */
async function hand(
  client: PoolClient,
  input: FoundInput,
  actorId: string,
  team: TeamId,
): Promise<Pick<Founded, "switchedOn" | "adminId" | "granted">> {
  const was = await setEnabledOn(client, input.lang, true, actorId);
  await giveTextToTeam(client, input.lang);
  const granted = input.adminId ? await grantOn(client, team, input.adminId, input.lang, ["admin", "text"], actorId) : [];
  return { switchedOn: !was, adminId: input.adminId, granted };
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
      // A second team's founding is filed in its own log, so in its language, which a filed row
      // must name; the language's other teams do not see it.
      ...(founded.branch === "second-team" ? { lang, team: founded.teamId } : {}),
    },
  ];
  if (founded.branch === "new-language") {
    events.push({ kind: "language.added", lang, actorId, detail: { name: founded.languageName ?? lang } });
  }
  if (founded.branch === "hand-over") {
    events.push({
      kind: "team.language_moved",
      lang,
      actorId,
      subject: slug,
      detail: { from: founded.from ?? "", to: slug },
    });
  }
  if (founded.branch === "second-team") {
    events.push({
      kind: "team.second_in_language",
      lang,
      actorId,
      subject: slug,
      detail: { slug, beside: founded.from ?? "", settings: founded.settings ?? "fresh" },
      team: founded.teamId,
    });
  }
  if (founded.switchedOn) events.push({ kind: "language.toggled", lang, actorId, detail: { enabled: true } });
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
