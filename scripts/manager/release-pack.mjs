// What a release builds: a page pack, exactly as before teams released, or a derived one.
//
// The language's privileged team, where the language has a store page on the Manager's channel
// for the section, builds the page's pack: folders, title, version, icon and .toc as they always
// were. Every other release is derived from English's Manager folders for the section, each with
// the language and, for a team other than the privileged one, the team's slug
// (scripts/lib/packs.mjs teamFolder). A derived pack has no page: its title names the language and
// team, its first version is 1.0.0 (publish.mjs bumps it from the channel after that), and its .toc
// names the team and, for a language Spoken does not build in, the language.
import { BASE_LOCALE } from "../../pipelines/lib/locales.mjs";
import { findPack, loadPacks, managerFolders, packsFor, teamFolder } from "../lib/packs.mjs";

/** `team` is releaseTeam's (release-team.mjs). */
export function releasePlan(section, lang, team, packs = loadPacks()) {
  const pages = managerFolders(packs).filter((p) => p.section === section && p.lang === lang);
  if (team.plain && pages.length > 0) {
    if (section === "quests") return { folders: pages, pack: null, derived: null };
    const pack = findPack(section, lang, null, packs);
    return { folders: pages.filter((p) => p.folder === pack.folder), pack, derived: null };
  }
  const derived = derivedPack(section, lang, team, packs);
  return { folders: derived.folders.map(({ folder }) => ({ folder, section, lang })), pack: null, derived };
}

function derivedPack(section, lang, team, packs) {
  const slug = team.plain ? null : team.slug;
  const english = packsFor(section, BASE_LOCALE, packs);
  const folders = managerFolders(packs)
    .filter((p) => p.section === section && p.lang === BASE_LOCALE)
    .map(({ folder: englishFolder }) => {
      const page = english.find((p) => p.folder === englishFolder);
      if (!page) throw new Error(`${englishFolder} has no English page to name a derived pack after`);
      // "Spoken Audio: Places" is English's; "Spoken Japanese Audio: Places" a language's.
      const title = page.name.replace(/^Spoken Audio:/, `Spoken ${team.language.name} Audio:`) + (slug ? ` (${team.name})` : "");
      return { folder: teamFolder(englishFolder, lang, slug), section, lang, pack: page.pack, title };
    });
  if (folders.length === 0) throw new Error(`English has no ${section} folders on the Manager's channel`);
  const toc = {
    ...(slug ? { team: slug, teamName: team.name } : {}),
    ...(team.language.client ? {} : { languageName: team.language.name, languageNative: team.language.native }),
  };
  return { folders, version: "1.0.0", toc };
}
