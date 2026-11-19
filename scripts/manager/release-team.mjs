// The team a release builds for, and the language it builds in, read from the database: the
// builders take a language from its `language` row, not from pipelines/lib/locales.mjs, so a
// language only the site knows can ship (docs/platform/TEAMS.md, *Releases*).
//
// A team's pack name in the language decides its folders: `plain` builds `<Pack>_<lang>`, `slug`
// `<Pack>_<lang>_<slug>` (scripts/lib/packs.mjs teamFolder).
import { derivedFolders, loadPacks } from "../lib/packs.mjs";

/** Every language's English and native names, which index-v2.json carries for the Manager. */
export async function languageNames(db) {
  const { rows } = await db.query(
    `select "code", "name", "native" from "language" where "name" is not null and "native" is not null order by "code"`,
  );
  return rows.map(({ code, name, native }) => ({ code, name, native }));
}

/**
 * `slug` null is the language's only team: `make manager-release`, or a press from before the site
 * named the team. A language with several teams has no default, so one must be named.
 */
export async function releaseTeam(db, lang, slug = null) {
  const { rows: languages } = await db.query(
    `select "code", "name", "native", "client" from "language" where "code" = $1`,
    [lang],
  );
  if (languages.length === 0) throw new Error(`${lang} is not a language`);
  const { rows } = await db.query(
    `select t."id", t."slug", t."name", t."official", tl."packName"
       from "team" t join "team_language" tl on tl."teamId" = t."id"
      where tl."lang" = $1 and ($2::text is null or t."slug" = $2)`,
    [lang, slug],
  );
  if (rows.length === 0) throw new Error(slug === null ? `${lang} has no team` : `no team ${slug} voices ${lang}`);
  if (rows.length > 1) throw new Error(`${lang} has several teams: name one with --team`);
  const [team] = rows;
  const [language] = languages;
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    official: team.official,
    packName: team.packName,
    language: { code: language.code, name: language.name, native: language.native, client: language.client },
  };
}

/**
 * Every folder the pack of the team `slug` in `section` and `lang` can have, as its releases build
 * them: what a delisting takes off the channel (`cli.mjs delist`).
 */
export async function teamPackFolders(db, section, lang, slug, packs = loadPacks()) {
  const team = await releaseTeam(db, lang, slug);
  return derivedFolders(section, lang, team.packName === "plain" ? null : team.slug, packs).map((p) => p.folder);
}
