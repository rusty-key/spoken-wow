/**
 * The sound packs as the landing page offers them: one per section per language, with where
 * each can be downloaded.
 *
 * THE SAME LIST AS publishers/ (read by scripts/lib/packs.mjs), restated here as a literal
 * because the standalone server ships without that directory. packs.test.ts fails if the two
 * drift, the way lang.test.ts guards the language list.
 *
 * English quests are listed once, as the All pack: on GitHub that is the bundle holding the four
 * split packs' folders, and on CurseForge, where the All project is a meta addon, the page links
 * the four split packs themselves (`split`).
 */
import { CURSEFORGE, githubReleases } from "@/components/landing/links";
import type { Lang } from "@/lib/lang";

export type Section = "quests" | "places" | "readables" | "bosses";

export type Pack = {
  section: Section;
  lang: Lang;
  /** The name it goes by on its store page and in the AddOns list. */
  name: string;
  /**
   * The CurseForge (and, where it exists, Wago) slug, or null for a pack only on GitHub. A pack
   * bundled in another's CurseForge project names that project's slug.
   */
  curseforge: string | null;
  /** The GitHub release tag prefix, `<release>/vX.Y.Z`. */
  release: string;
  /**
   * The packs CurseForge splits this one into, linked instead of `curseforge` itself: quests
   * only. English's All project there is a meta addon holding no audio, and a language's
   * one-folder quests pack is on GitHub alone.
   */
  split?: readonly PackPart[];
};

/** One of the folders a quests pack ships as, with its own CurseForge project. */
export type PackPart = { label: string; slug: string; folder: string; name: string };

export const PACKS: readonly Pack[] = [
  {
    section: "quests",
    lang: "enUS",
    name: "Spoken Quests Audio: All",
    curseforge: "spoken-audio-quests-all",
    release: "quests-audio",
    split: [
      { label: "Alliance", slug: "spoken-audio-quests-alliance", folder: "SpokenQuestsAudioAlliance", name: "Spoken Audio: Quests - Alliance" },
      { label: "Horde", slug: "spoken-audio-quests-horde", folder: "SpokenQuestsAudioHorde", name: "Spoken Audio: Quests - Horde" },
      { label: "Shared", slug: "spoken-audio-quests-shared", folder: "SpokenQuestsAudioShared", name: "Spoken Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-audio-gossip", folder: "SpokenQuestsAudioGossip", name: "Spoken Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "deDE",
    name: "Spoken Quests Audio: German",
    curseforge: null,
    release: "quests-audio-deDE",
    split: [
      { label: "Alliance", slug: "spoken-german-audio-quests-alliance", folder: "SpokenQuestsAudioAlliance_deDE", name: "Spoken German Audio: Quests - Alliance" },
      { label: "Horde", slug: "spoken-german-audio-quests-horde", folder: "SpokenQuestsAudioHorde_deDE", name: "Spoken German Audio: Quests - Horde" },
      { label: "Shared", slug: "spoken-german-audio-quests-shared", folder: "SpokenQuestsAudioShared_deDE", name: "Spoken German Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-german-audio-gossip", folder: "SpokenQuestsAudioGossip_deDE", name: "Spoken German Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "esES",
    name: "Spoken Quests Audio: Spanish (EU)",
    curseforge: null,
    release: "quests-audio-esES",
    split: [
      { label: "Alliance", slug: "spoken-spanish-eu-audio-quests-alliance", folder: "SpokenQuestsAudioAlliance_esES", name: "Spoken Spanish (EU) Audio: Quests - Alliance" },
      { label: "Horde", slug: "spoken-spanish-eu-audio-quests-horde", folder: "SpokenQuestsAudioHorde_esES", name: "Spoken Spanish (EU) Audio: Quests - Horde" },
      { label: "Shared", slug: "spoken-spanish-eu-audio-quests-shared", folder: "SpokenQuestsAudioShared_esES", name: "Spoken Spanish (EU) Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-spanish-eu-audio-gossip", folder: "SpokenQuestsAudioGossip_esES", name: "Spoken Spanish (EU) Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "esMX",
    name: "Spoken Quests Audio: Spanish (AL)",
    curseforge: null,
    release: "quests-audio-esMX",
    split: [
      { label: "Alliance", slug: "spoken-spanish-al-audio-quests-alliance", folder: "SpokenQuestsAudioAlliance_esMX", name: "Spoken Spanish (AL) Audio: Quests - Alliance" },
      { label: "Horde", slug: "spoken-spanish-al-audio-quests-horde", folder: "SpokenQuestsAudioHorde_esMX", name: "Spoken Spanish (AL) Audio: Quests - Horde" },
      { label: "Shared", slug: "spoken-spanish-al-audio-quests-shared", folder: "SpokenQuestsAudioShared_esMX", name: "Spoken Spanish (AL) Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-spanish-al-audio-gossip", folder: "SpokenQuestsAudioGossip_esMX", name: "Spoken Spanish (AL) Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "frFR",
    name: "Spoken Quests Audio: French",
    curseforge: null,
    release: "quests-audio-frFR",
    split: [
      { label: "Alliance", slug: "spoken-french-audio-quests-alliance", folder: "SpokenQuestsAudioAlliance_frFR", name: "Spoken French Audio: Quests - Alliance" },
      { label: "Horde", slug: "spoken-french-audio-quests-horde", folder: "SpokenQuestsAudioHorde_frFR", name: "Spoken French Audio: Quests - Horde" },
      { label: "Shared", slug: "spoken-french-audio-quests-shared", folder: "SpokenQuestsAudioShared_frFR", name: "Spoken French Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-french-audio-gossip", folder: "SpokenQuestsAudioGossip_frFR", name: "Spoken French Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "itIT",
    name: "Spoken Quests Audio: Italian",
    curseforge: null,
    release: "quests-audio-itIT",
    split: [
      { label: "Quests", slug: "spoken-italian-audio-quests-shared", folder: "SpokenQuestsAudioShared_itIT", name: "Spoken Italian Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-italian-audio-gossip", folder: "SpokenQuestsAudioGossip_itIT", name: "Spoken Italian Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "ptBR",
    name: "Spoken Quests Audio: Portuguese",
    curseforge: null,
    release: "quests-audio-ptBR",
    split: [
      { label: "Quests", slug: "spoken-portuguese-audio-quests-shared", folder: "SpokenQuestsAudioShared_ptBR", name: "Spoken Portuguese Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-portuguese-audio-gossip", folder: "SpokenQuestsAudioGossip_ptBR", name: "Spoken Portuguese Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "ruRU",
    name: "Spoken Quests Audio: Russian",
    curseforge: null,
    release: "quests-audio-ruRU",
    split: [
      { label: "Quests", slug: "spoken-russian-audio-quests-shared", folder: "SpokenQuestsAudioShared_ruRU", name: "Spoken Russian Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-russian-audio-gossip", folder: "SpokenQuestsAudioGossip_ruRU", name: "Spoken Russian Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "koKR",
    name: "Spoken Quests Audio: Korean",
    curseforge: null,
    release: "quests-audio-koKR",
    split: [
      { label: "Quests", slug: "spoken-korean-audio-quests-shared", folder: "SpokenQuestsAudioShared_koKR", name: "Spoken Korean Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-korean-audio-gossip", folder: "SpokenQuestsAudioGossip_koKR", name: "Spoken Korean Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "zhCN",
    name: "Spoken Quests Audio: Chinese (Simplified)",
    curseforge: null,
    release: "quests-audio-zhCN",
    split: [
      { label: "Quests", slug: "spoken-chinese-simplified-audio-quests-shared", folder: "SpokenQuestsAudioShared_zhCN", name: "Spoken Chinese (Simplified) Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-chinese-simplified-audio-gossip", folder: "SpokenQuestsAudioGossip_zhCN", name: "Spoken Chinese (Simplified) Audio: Gossip" },
    ],
  },
  {
    section: "quests",
    lang: "zhTW",
    name: "Spoken Quests Audio: Chinese (Traditional)",
    curseforge: null,
    release: "quests-audio-zhTW",
    split: [
      { label: "Quests", slug: "spoken-chinese-traditional-audio-quests-shared", folder: "SpokenQuestsAudioShared_zhTW", name: "Spoken Chinese (Traditional) Audio: Quests - Shared" },
      { label: "Gossip", slug: "spoken-chinese-traditional-audio-gossip", folder: "SpokenQuestsAudioGossip_zhTW", name: "Spoken Chinese (Traditional) Audio: Gossip" },
    ],
  },

  {
    section: "places",
    lang: "enUS",
    name: "Spoken Audio: Places and Bosses",
    curseforge: "spoken-audio-places",
    release: "places-audio",
  },
  {
    section: "places",
    lang: "deDE",
    name: "Spoken German Audio: Places",
    curseforge: "spoken-german-audio-places",
    release: "places-audio-deDE",
  },
  {
    section: "places",
    lang: "esES",
    name: "Spoken Spanish (EU) Audio: Places",
    curseforge: "spoken-spanish-eu-audio-places",
    release: "places-audio-esES",
  },
  {
    section: "places",
    lang: "esMX",
    name: "Spoken Spanish (AL) Audio: Places",
    curseforge: "spoken-spanish-al-audio-places",
    release: "places-audio-esMX",
  },
  {
    section: "places",
    lang: "frFR",
    name: "Spoken French Audio: Places",
    curseforge: "spoken-french-audio-places",
    release: "places-audio-frFR",
  },
  {
    section: "places",
    lang: "ptBR",
    name: "Spoken Portuguese Audio: Places",
    curseforge: "spoken-portuguese-audio-places",
    release: "places-audio-ptBR",
  },
  {
    section: "places",
    lang: "ruRU",
    name: "Spoken Russian Audio: Places",
    curseforge: "spoken-russian-audio-places",
    release: "places-audio-ruRU",
  },
  {
    section: "places",
    lang: "koKR",
    name: "Spoken Korean Audio: Places",
    curseforge: "spoken-korean-audio-places",
    release: "places-audio-koKR",
  },
  {
    section: "places",
    lang: "zhCN",
    name: "Spoken Chinese (Simplified) Audio: Places",
    curseforge: "spoken-chinese-simplified-audio-places",
    release: "places-audio-zhCN",
  },
  {
    section: "places",
    lang: "zhTW",
    name: "Spoken Chinese (Traditional) Audio: Places",
    curseforge: "spoken-chinese-traditional-audio-places",
    release: "places-audio-zhTW",
  },

  {
    section: "readables",
    lang: "enUS",
    name: "Spoken Audio: Readables",
    curseforge: "spoken-audio-readables",
    release: "readables-audio",
  },
  {
    section: "readables",
    lang: "deDE",
    name: "Spoken German Audio: Readables",
    curseforge: "spoken-german-audio-readables",
    release: "readables-audio-deDE",
  },
  {
    section: "readables",
    lang: "esES",
    name: "Spoken Spanish (EU) Audio: Readables",
    curseforge: "spoken-spanish-eu-audio-readables",
    release: "readables-audio-esES",
  },
  {
    section: "readables",
    lang: "esMX",
    name: "Spoken Spanish (AL) Audio: Readables",
    curseforge: "spoken-spanish-al-audio-readables",
    release: "readables-audio-esMX",
  },
  {
    section: "readables",
    lang: "frFR",
    name: "Spoken French Audio: Readables",
    curseforge: "spoken-french-audio-readables",
    release: "readables-audio-frFR",
  },
  {
    section: "readables",
    lang: "ruRU",
    name: "Spoken Russian Audio: Readables",
    curseforge: "spoken-russian-audio-readables",
    release: "readables-audio-ruRU",
  },
  {
    section: "readables",
    lang: "ptBR",
    name: "Spoken Portuguese Audio: Readables",
    curseforge: "spoken-portuguese-audio-readables",
    release: "readables-audio-ptBR",
  },
  {
    section: "readables",
    lang: "koKR",
    name: "Spoken Korean Audio: Readables",
    curseforge: "spoken-korean-audio-readables",
    release: "readables-audio-koKR",
  },
  {
    section: "readables",
    lang: "zhCN",
    name: "Spoken Chinese (Simplified) Audio: Readables",
    curseforge: "spoken-chinese-simplified-audio-readables",
    release: "readables-audio-zhCN",
  },
  {
    section: "readables",
    lang: "zhTW",
    name: "Spoken Chinese (Traditional) Audio: Readables",
    curseforge: "spoken-chinese-traditional-audio-readables",
    release: "readables-audio-zhTW",
  },

  // On CurseForge inside Spoken Audio: Places and Bosses, which carries its folder.
  {
    section: "bosses",
    lang: "enUS",
    name: "Spoken Audio: Bosses",
    curseforge: "spoken-audio-places",
    release: "bosses-audio",
  },
  { section: "bosses", lang: "deDE", name: "Spoken German Audio: Bosses", curseforge: "spoken-german-audio-bosses", release: "bosses-audio-deDE" },
  { section: "bosses", lang: "esES", name: "Spoken Spanish (EU) Audio: Bosses", curseforge: "spoken-spanish-eu-audio-bosses", release: "bosses-audio-esES" },
  { section: "bosses", lang: "esMX", name: "Spoken Spanish (AL) Audio: Bosses", curseforge: "spoken-spanish-al-audio-bosses", release: "bosses-audio-esMX" },
  { section: "bosses", lang: "frFR", name: "Spoken French Audio: Bosses", curseforge: "spoken-french-audio-bosses", release: "bosses-audio-frFR" },
  { section: "bosses", lang: "ptBR", name: "Spoken Portuguese Audio: Bosses", curseforge: "spoken-portuguese-audio-bosses", release: "bosses-audio-ptBR" },
  { section: "bosses", lang: "ruRU", name: "Spoken Russian Audio: Bosses", curseforge: "spoken-russian-audio-bosses", release: "bosses-audio-ruRU" },
  { section: "bosses", lang: "koKR", name: "Spoken Korean Audio: Bosses", curseforge: "spoken-korean-audio-bosses", release: "bosses-audio-koKR" },
  { section: "bosses", lang: "zhCN", name: "Spoken Chinese (Simplified) Audio: Bosses", curseforge: "spoken-chinese-simplified-audio-bosses", release: "bosses-audio-zhCN" },
  { section: "bosses", lang: "zhTW", name: "Spoken Chinese (Traditional) Audio: Bosses", curseforge: "spoken-chinese-traditional-audio-bosses", release: "bosses-audio-zhTW" },
];

/** The pack for a section in a language, or undefined where none has been built. */
export function packFor(section: Section, lang: Lang): Pack | undefined {
  return PACKS.find((pack) => pack.section === section && pack.lang === lang);
}

/** The part of `pack` shipped in the addon folder `folder`, or undefined. */
export function partOf(pack: Pack | undefined, folder: string | undefined): PackPart | undefined {
  return folder ? pack?.split?.find((part) => part.folder === folder) : undefined;
}

/**
 * Where a pack downloads by hand: its CurseForge projects (a split pack's parts, labelled, or only
 * `only`) and its GitHub releases.
 */
export function packDownloads(pack: Pack, only?: PackPart): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  if (only) {
    links.push({ label: "CurseForge", href: `${CURSEFORGE}/${only.slug}` });
  } else if (pack.split) {
    for (const part of pack.split) links.push({ label: `CurseForge: ${part.label}`, href: `${CURSEFORGE}/${part.slug}` });
  } else if (pack.curseforge) {
    links.push({ label: "CurseForge", href: `${CURSEFORGE}/${pack.curseforge}` });
  }
  links.push({ label: pack.split ? "GitHub: all" : "GitHub", href: githubReleases(pack.release) });
  return links;
}
