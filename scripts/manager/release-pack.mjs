// What a release builds: a page pack, exactly as before teams released, or a derived one, in
// one description that the builders and publish read without asking which it is.
//
// The language's privileged team, where the language has a store page on the Manager's channel
// for the section, builds the page's pack: folders, title, version, icon and .toc as they always
// were. Every other release is derived from English's Manager folders for the section, each with
// the language and, for a team other than the privileged one, the team's slug
// (scripts/lib/packs.mjs derivedFolders). A derived pack has no page: its title names the language
// and team, its first version is 1.0.0 (publish.mjs bumps it from the channel after that), and its
// .toc names the team and, for a language Spoken does not build in, the language.
import { BASE_LOCALE } from "../../pipelines/lib/locales.mjs";
import { derivedFolders, findPack, loadPacks, managerFolders, packsFor } from "../lib/packs.mjs";
import { keepsCommittedFolder } from "./stage-pack.mjs";

/**
 * `team` is releaseTeam's (release-team.mjs). The plan:
 *
 * - `folders`: `{ folder, section, lang, pack, title, version, team }` each. `title` null keeps
 *   the build's own (English's quests packs); `version` null is English's, from its changelog
 *   (quests) or its .toc; `team` null is a page pack's, listed with no team (index-v2.json).
 * - `toc`: the .toc keys a derived pack adds (stage-pack.mjs tocExtra); empty for a page pack.
 * - `readmePage`: the store page whose body is the README, or null to keep the folder's own.
 * - `badgeOptional`: with no badge drawn for its language the pack wears English's mark, where a
 *   page pack's missing badge is an error.
 * - `tocLanguage`: the .toc names the language in the section's own key (readables), as nothing
 *   else tells the addon a derived pack's language.
 */
export function releasePlan(section, lang, team, packs = loadPacks()) {
  const pages = managerFolders(packs).filter((p) => p.section === section && p.lang === lang);
  if (team.privileged && pages.length > 0) return pagePlan(section, lang, pages, packs);
  return derivedPlan(section, lang, team, packs);
}

function pagePlan(section, lang, pages, packs) {
  const plan = { toc: {}, badgeOptional: false, tocLanguage: false };
  if (section === "quests") {
    const own = packsFor("quests", lang, packs);
    const folders = pages.map(({ folder }) => {
      const page = own.find((p) => p.folder === folder);
      if (!page) throw new Error(`${folder} has no quests page for ${lang}`);
      const title = lang === BASE_LOCALE ? null : page.name;
      return { folder, section, lang, pack: page.pack, title, version: page.version, team: null };
    });
    return { ...plan, folders, readmePage: null };
  }
  const page = findPack(section, lang, null, packs);
  const folders = pages
    .filter((p) => p.folder === page.folder)
    .map(({ folder }) => ({ folder, section, lang, pack: page.pack, title: page.name, version: page.version, team: null }));
  return { ...plan, folders, readmePage: keepsCommittedFolder(section, page.folder) ? null : page.page };
}

function derivedPlan(section, lang, team, packs) {
  const slug = team.privileged ? null : team.slug;
  const english = packsFor(section, BASE_LOCALE, packs);
  const listed = { slug: team.slug, name: team.name, official: team.official };
  const folders = derivedFolders(section, lang, slug, packs).map(({ folder, english: englishFolder }) => {
    const page = english.find((p) => p.folder === englishFolder);
    if (!page) throw new Error(`${englishFolder} has no English page to name a derived pack after`);
    // "Spoken Audio: Places" is English's; "Spoken Japanese Audio: Places" a language's.
    const title = page.name.replace(/^Spoken Audio:/, `Spoken ${team.language.name} Audio:`) + (slug ? ` (${team.name})` : "");
    return { folder, section, lang, pack: page.pack, title, version: "1.0.0", team: listed };
  });
  const toc = {
    ...(slug ? { team: slug, teamName: team.name } : {}),
    ...(team.language.client ? {} : { languageName: team.language.name, languageNative: team.language.native }),
  };
  // English's README, which the folder already holds, stays.
  return { folders, toc, readmePage: null, badgeOptional: true, tocLanguage: true };
}
