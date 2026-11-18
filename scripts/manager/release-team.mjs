// The team a release builds for, and the language it builds in, read from the database: the
// builders take a language from its `language` row, not from pipelines/lib/locales.mjs, so a
// language only the site knows can ship (docs/platform/TEAMS.md, *Releases*).
//
// A team holding the language's plain space (its privileged team) builds the plain pack ids;
// any other team's carry its slug (scripts/lib/packs.mjs teamFolder).

/**
 * `slug` null is the language's privileged team: a release pressed before the site named the
 * team, or `make manager-release`.
 */
export async function releaseTeam(db, lang, slug = null) {
  const { rows: languages } = await db.query(
    `select "code", "name", "native", "client" from "language" where "code" = $1`,
    [lang],
  );
  if (languages.length === 0) throw new Error(`${lang} is not a language`);
  const { rows } = await db.query(
    `select t."id", t."slug", t."name", t."official", tl."privileged"
       from "team" t join "team_language" tl on tl."teamId" = t."id"
      where tl."lang" = $1 and (case when $2::text is null then tl."privileged" else t."slug" = $2 end)`,
    [lang, slug],
  );
  if (rows.length === 0) throw new Error(slug === null ? `${lang} has no team` : `no team ${slug} voices ${lang}`);
  const [team] = rows;
  const [language] = languages;
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    official: team.official,
    privileged: team.privileged,
    plain: team.privileged,
    language: { code: language.code, name: language.name, native: language.native, client: language.client },
  };
}
