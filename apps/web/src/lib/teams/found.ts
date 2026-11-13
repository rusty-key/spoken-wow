/**
 * The one step that founds a team in a language, run by a request's approval and by the New team
 * form. It picks its branch from the language's state when it runs, not when it was asked for
 * (SELF-SERVE-TEAMS.md, *What approval does*):
 *
 * - a code with no `language` row is created, switched on, with the new team owning it;
 * - a known language nobody looks after is handed over to a new team and switched on;
 * - a language somebody looks after needs a second team, which plan 5 builds.
 *
 * Both working branches give `text` to the team (`textByTeam`) and `admin` and `text` to its
 * admin. Everything is written on the caller's client, in its transaction; afterFounded logs it
 * once that commits.
 */
import "server-only";

import type { ClientBase, PoolClient } from "pg";

import { recordActivities, type ActivityEvent } from "@/lib/activity/store";
import { ALL_TEAMS, actAs, query } from "@/lib/db";
import { grantOn } from "@/lib/grants/store";
import { BASE_LANG, langName } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew, giveTextToTeam, LanguageExistsError, setEnabledOn } from "@/lib/languages/store";
import type { Capability } from "@/lib/permissions";

import { moveLang, SLUG, TeamError } from "./admin";
import { adoptLang, forgetTeams, type TeamId } from "./store";

export type Branch = "new-language" | "hand-over" | "second-team";

export type FoundInput = {
  lang: string;
  /** English and native names, used only when the code is new. */
  language: { name: string; native: string } | null;
  /** A null slug is derived from the name. */
  team: { slug: string | null; name: string };
  adminId: string | null;
};

export type Founded = {
  branch: Branch;
  teamId: TeamId;
  slug: string;
  lang: string;
  /** The slug of the team the language was handed over from. */
  from: string | null;
  moved: number;
  switchedOn: boolean;
  adminId: string | null;
  granted: Capability[];
  /** The English name of a language this created. */
  languageName: string | null;
};

const SLUG_MAX = 41;

/** Read on the caller's client when given, so it sees that transaction's writes. */
async function rows<T extends Record<string, unknown>>(client: ClientBase | undefined, text: string, params: unknown[]) {
  return client ? (await client.query<T>(text, params)).rows : query<T>(text, params);
}

/**
 * The language's privileged team when somebody looks after it: a member of that team in this
 * language, or a text maintainer, who is not a site owner. A site owner's grants do not count:
 * they hold them to keep a language running, not to keep it.
 */
export async function activeTeamOf(lang: string, client?: ClientBase): Promise<TeamId | null> {
  const found = await rows<{ teamId: TeamId }>(
    client,
    `select tl."teamId" from "team_language" tl
      where tl."lang" = $1 and tl."privileged"
        and (exists (select 1 from "team_member" m join "user" u on u."id" = m."userId"
                      where m."teamId" = tl."teamId" and m."lang" = $1 and u."role" is distinct from 'admin')
          or exists (select 1 from "language_grant" g join "user" u on u."id" = g."userId"
                      where g."lang" = $1 and u."role" is distinct from 'admin'))`,
    [lang],
  );
  return found[0]?.teamId ?? null;
}

export async function languageBranch(lang: string, client?: ClientBase): Promise<Branch> {
  const known = await rows(client, `select 1 from "language" where "code" = $1`, [lang]);
  if (!known.length) return "new-language";
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
  if (input.team.slug !== null && !SLUG.test(input.team.slug)) {
    throw new TeamError("A team's slug is lowercase letters, digits and dashes, starting with a letter.");
  }
  await client.query(`select 1 from "language" where "code" = $1 for update`, [input.lang]);
  switch (await languageBranch(input.lang, client)) {
    case "new-language":
      return foundLanguage(client, input, actorId);
    case "hand-over":
      return takeOverLanguage(client, input, actorId);
    case "second-team":
      return addSecondTeam(client, input, actorId);
  }
}

/** A new code: the language, switched on, and the team addLanguage made for it, renamed as asked. */
export async function foundLanguage(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  if (!input.language) throw new TeamError(`${input.lang} is a new language: it needs an English and a native name.`);
  try {
    await addLanguage(client, describeNew(input.lang, input.language.name, input.language.native), actorId);
  } catch (error) {
    if (error instanceof LanguageExistsError) throw new TeamError(error.message, 409);
    throw error;
  }
  // The team adopt_lang made is slugged by the code; a name that falls back to the code keeps it.
  const base = slugFor(input.team.name, input.lang);
  const [team] = await named(
    client,
    input.team.slug,
    `update "team"
        set "slug" = coalesce($1, case when "slug" = $2 then "slug" else free_team_slug($2) end), "name" = $3
      where "id" = team_of_lang($4)
      returning "id", "slug"`,
    [input.team.slug, base, input.team.name, input.lang],
  );
  return {
    ...(await hand(client, input, actorId, team.id)),
    branch: "new-language",
    teamId: team.id,
    slug: team.slug,
    lang: input.lang,
    from: null,
    moved: 0,
    languageName: input.language.name,
  };
}

/** A known language nobody looks after: a new team, which the language moves to with its rows. */
export async function takeOverLanguage(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded> {
  const slug =
    input.team.slug ??
    (await client.query<{ slug: string }>(`select free_team_slug($1) as "slug"`, [slugFor(input.team.name, input.lang)]))
      .rows[0].slug;
  const [team] = await named(client, slug, `select new_team($1, $2) as "id", $1::text as "slug"`, [slug, input.team.name]);
  // A language with a row but no team yet has nothing to move from.
  await adoptLang(client, input.lang);
  const { moved, from } = await moveLang(client, input.lang, team.id);
  return {
    ...(await hand(client, input, actorId, team.id)),
    branch: "hand-over",
    teamId: team.id,
    slug: team.slug,
    lang: input.lang,
    from,
    moved,
    languageName: null,
  };
}

/**
 * A language somebody already looks after gets a second team beside its privileged one: the
 * third row of SELF-SERVE-TEAMS.md *What approval does* ("Known, with an active team"), whose
 * text stays with the maintainers the site owner appoints. Plan 5 fills this in; until then
 * approval refuses.
 */
export async function addSecondTeam(_client: PoolClient, input: FoundInput, _actorId: string): Promise<Founded> {
  throw new TeamError(
    `${langName(input.lang)} already has an active team; approving this request needs a second team (plan 5).`,
    409,
  );
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

/** What both working branches end with: the language switched on, `text` given to its team, the admin granted. */
async function hand(
  client: PoolClient,
  input: FoundInput,
  actorId: string,
  team: TeamId,
): Promise<Pick<Founded, "switchedOn" | "adminId" | "granted">> {
  const was = await setEnabledOn(client, input.lang, true, actorId);
  await giveTextToTeam(client, input.lang);
  const granted = input.adminId ? await grantOn(client, team, input.adminId, input.lang, ["admin", "text"], actorId) : [];
  return { switchedOn: was !== true, adminId: input.adminId, granted };
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
  const events: ActivityEvent[] = [{ kind: "team.created", lang: null, actorId, subject: slug, detail: { slug } }];
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
  if (founded.switchedOn) events.push({ kind: "language.toggled", lang, actorId, detail: { enabled: true } });
  for (const capability of founded.granted) {
    events.push({ kind: "grant.added", lang, subject: founded.adminId, actorId, detail: { capability } });
  }
  await recordActivities(events);
}
