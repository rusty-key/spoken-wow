// The team whose live takes a build reads. A release names it in SPOKEN_RELEASE_TEAM
// (scripts/manager/release.mjs), so a second team's pack is built from its own takes and never
// from the privileged team's; a build outside a release reads the privileged team's, as it always
// did. Each builder's query is a string handed to psql or pg, so the id is inlined: checked
// here to be a uuid, so the text inlined is never anything else.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The release's team id, null outside a release; throws on anything but a uuid. */
export function releaseTeamId(env = process.env) {
  const team = env.SPOKEN_RELEASE_TEAM;
  if (!team) return null;
  if (!UUID.test(team)) throw new Error(`SPOKEN_RELEASE_TEAM=${team} is not a team id`);
  return team.toLowerCase();
}

/** SQL for the team whose takes a build of `langExpr`'s pack reads. */
export function releaseTeamSql(langExpr, env = process.env) {
  const team = releaseTeamId(env);
  return team ? `'${team}'::uuid` : `team_of_lang(${langExpr})`;
}
