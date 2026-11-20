// The team whose live takes a build reads. A release names it in SPOKEN_RELEASE_TEAM
// (scripts/manager/release.mjs), so a team's pack is built from its own takes and never from
// another's; a build outside a release reads the team with the language's plain packs, and a
// language with none reads no team. Each builder's query is a string handed to psql or pg, so the
// id is inlined: checked here to be a uuid, so the text inlined is never anything else.
import { execFileSync } from "node:child_process";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The release's team id, null outside a release; throws on anything but a uuid. */
export function releaseTeamId(env = process.env) {
  const team = env.SPOKEN_RELEASE_TEAM;
  if (!team) return null;
  if (!UUID.test(team)) throw new Error(`SPOKEN_RELEASE_TEAM=${team} is not a team id`);
  return team.toLowerCase();
}

/** SQL for the team whose packs in `langExpr` carry no slug: null when no team's do. */
export function plainTeamSql(langExpr) {
  return `team_of_lang(${langExpr})`;
}

/** SQL for the team whose takes a build of `langExpr`'s pack reads. */
export function releaseTeamSql(langExpr, env = process.env) {
  const team = releaseTeamId(env);
  return team ? `'${team}'::uuid` : plainTeamSql(langExpr);
}

/**
 * The team a script run by hand reads in `lang`, with its pack name there: the one `slug` names
 * (its --team), else the one with plain packs. Throws rather than read nothing when there is none.
 */
export function scriptTeam(database, lang, slug = null) {
  const row = execFileSync("psql", [database, "-tAX", "-v", "ON_ERROR_STOP=1", "-v", `lang=${lang}`, "-v", `slug=${slug ?? ""}`, "-f", "-"], {
    input: `select tl."teamId", tl."packName" from "team_language" tl join "team" t on t."id" = tl."teamId"
             where tl."lang" = :'lang'
               and case when :'slug' = '' then tl."packName" = 'plain' else t."slug" = :'slug' end`,
    encoding: "utf8",
  }).trim();
  if (row) {
    const [id, packName] = row.split("|");
    return { id, packName };
  }
  throw new Error(slug ? `no team ${slug} voices ${lang}` : `${lang} has no team with plain packs: name one with --team`);
}

/** scriptTeam's id. */
export function scriptTeamId(database, lang, slug = null) {
  return scriptTeam(database, lang, slug).id;
}
