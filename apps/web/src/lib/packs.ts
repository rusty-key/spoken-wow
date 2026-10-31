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
import type { Lang } from "@/lib/lang";

export type Section = "quests" | "places" | "readables" | "bosses";

export type Pack = {
  section: Section;
  lang: Lang;
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
  split?: readonly { label: string; slug: string }[];
};

export const PACKS: readonly Pack[] = [
  {
    section: "quests",
    lang: "enUS",
    curseforge: "spoken-quests-audio-all",
    release: "quests-audio",
    split: [
      { label: "Alliance", slug: "spoken-audio-quests-alliance" },
      { label: "Horde", slug: "spoken-audio-quests-horde" },
      { label: "Shared", slug: "spoken-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "deDE",
    curseforge: null,
    release: "quests-audio-deDE",
    split: [
      { label: "Alliance", slug: "spoken-german-audio-quests-alliance" },
      { label: "Horde", slug: "spoken-german-audio-quests-horde" },
      { label: "Shared", slug: "spoken-german-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-german-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "esES",
    curseforge: null,
    release: "quests-audio-esES",
    split: [
      { label: "Alliance", slug: "spoken-spanish-eu-audio-quests-alliance" },
      { label: "Horde", slug: "spoken-spanish-eu-audio-quests-horde" },
      { label: "Shared", slug: "spoken-spanish-eu-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-spanish-eu-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "esMX",
    curseforge: null,
    release: "quests-audio-esMX",
    split: [
      { label: "Alliance", slug: "spoken-spanish-al-audio-quests-alliance" },
      { label: "Horde", slug: "spoken-spanish-al-audio-quests-horde" },
      { label: "Shared", slug: "spoken-spanish-al-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-spanish-al-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "frFR",
    curseforge: null,
    release: "quests-audio-frFR",
    split: [
      { label: "Alliance", slug: "spoken-french-audio-quests-alliance" },
      { label: "Horde", slug: "spoken-french-audio-quests-horde" },
      { label: "Shared", slug: "spoken-french-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-french-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "itIT",
    curseforge: null,
    release: "quests-audio-itIT",
    split: [
      { label: "Quests", slug: "spoken-italian-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-italian-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "ptBR",
    curseforge: null,
    release: "quests-audio-ptBR",
    split: [
      { label: "Quests", slug: "spoken-portuguese-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-portuguese-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "ruRU",
    curseforge: null,
    release: "quests-audio-ruRU",
    split: [
      { label: "Quests", slug: "spoken-russian-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-russian-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "koKR",
    curseforge: null,
    release: "quests-audio-koKR",
    split: [
      { label: "Quests", slug: "spoken-korean-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-korean-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "zhCN",
    curseforge: null,
    release: "quests-audio-zhCN",
    split: [
      { label: "Quests", slug: "spoken-chinese-simplified-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-chinese-simplified-audio-gossip" },
    ],
  },
  {
    section: "quests",
    lang: "zhTW",
    curseforge: null,
    release: "quests-audio-zhTW",
    split: [
      { label: "Quests", slug: "spoken-chinese-traditional-audio-quests-shared" },
      { label: "Gossip", slug: "spoken-chinese-traditional-audio-gossip" },
    ],
  },

  {
    section: "places",
    lang: "enUS",
    curseforge: "spoken-audio-places",
    release: "places-audio",
  },
  {
    section: "places",
    lang: "deDE",
    curseforge: "spoken-german-audio-places",
    release: "places-audio-deDE",
  },
  {
    section: "places",
    lang: "esES",
    curseforge: "spoken-spanish-eu-audio-places",
    release: "places-audio-esES",
  },
  {
    section: "places",
    lang: "esMX",
    curseforge: "spoken-spanish-al-audio-places",
    release: "places-audio-esMX",
  },
  {
    section: "places",
    lang: "frFR",
    curseforge: "spoken-french-audio-places",
    release: "places-audio-frFR",
  },
  {
    section: "places",
    lang: "ptBR",
    curseforge: "spoken-portuguese-audio-places",
    release: "places-audio-ptBR",
  },
  {
    section: "places",
    lang: "ruRU",
    curseforge: "spoken-russian-audio-places",
    release: "places-audio-ruRU",
  },
  {
    section: "places",
    lang: "koKR",
    curseforge: "spoken-korean-audio-places",
    release: "places-audio-koKR",
  },
  {
    section: "places",
    lang: "zhCN",
    curseforge: "spoken-chinese-simplified-audio-places",
    release: "places-audio-zhCN",
  },
  {
    section: "places",
    lang: "zhTW",
    curseforge: "spoken-chinese-traditional-audio-places",
    release: "places-audio-zhTW",
  },

  {
    section: "readables",
    lang: "enUS",
    curseforge: "spoken-audio-readables",
    release: "readables-audio",
  },
  {
    section: "readables",
    lang: "deDE",
    curseforge: "spoken-german-audio-readables",
    release: "readables-audio-deDE",
  },
  {
    section: "readables",
    lang: "esES",
    curseforge: "spoken-spanish-eu-audio-readables",
    release: "readables-audio-esES",
  },
  {
    section: "readables",
    lang: "esMX",
    curseforge: "spoken-spanish-al-audio-readables",
    release: "readables-audio-esMX",
  },
  {
    section: "readables",
    lang: "frFR",
    curseforge: "spoken-french-audio-readables",
    release: "readables-audio-frFR",
  },
  {
    section: "readables",
    lang: "ruRU",
    curseforge: "spoken-russian-audio-readables",
    release: "readables-audio-ruRU",
  },
  {
    section: "readables",
    lang: "ptBR",
    curseforge: "spoken-portuguese-audio-readables",
    release: "readables-audio-ptBR",
  },
  {
    section: "readables",
    lang: "koKR",
    curseforge: "spoken-korean-audio-readables",
    release: "readables-audio-koKR",
  },
  {
    section: "readables",
    lang: "zhCN",
    curseforge: "spoken-chinese-simplified-audio-readables",
    release: "readables-audio-zhCN",
  },
  {
    section: "readables",
    lang: "zhTW",
    curseforge: "spoken-chinese-traditional-audio-readables",
    release: "readables-audio-zhTW",
  },

  // On CurseForge inside Spoken Audio: Places and Bosses, which carries its folder.
  {
    section: "bosses",
    lang: "enUS",
    curseforge: "spoken-audio-places",
    release: "bosses-audio",
  },
];

/** The pack for a section in a language, or undefined where none has been built. */
export function packFor(section: Section, lang: Lang): Pack | undefined {
  return PACKS.find((pack) => pack.section === section && pack.lang === lang);
}
