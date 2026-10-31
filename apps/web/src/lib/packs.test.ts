import { describe, expect, it } from "vitest";

import { loadPacks } from "../../../../scripts/lib/packs.mjs";

import { PACKS } from "./packs";

type RegistryPack = {
  section: string;
  lang: string;
  pack: string | null;
  curseforge: string | null;
  bundledIn: string | null;
  slug: string;
  release: string;
  github: boolean;
};

const key = (pack: { section: string; lang: string }) => `${pack.section}/${pack.lang}`;

describe("the landing page's pack list", () => {
  // The page restates publishers/ because the server ships without it. A pack added there and
  // not here is a download nobody is offered; one here and not there, a link to nothing.
  it("is the publishers' registry, one pack per section per language", () => {
    const registry = (loadPacks() as RegistryPack[])
      // English quests' four split packs stay off GitHub and sit behind the All page.
      .filter((pack) => pack.pack === null || pack.pack === "all")
      .map((pack) => ({
        section: pack.section,
        lang: pack.lang,
        curseforge: pack.curseforge ? pack.slug : pack.bundledIn,
        release: pack.github ? pack.release : null,
      }));

    const withoutSplit = PACKS.map(({ split: _split, ...pack }) => pack);
    const sorted = <T extends { section: string; lang: string }>(packs: readonly T[]) =>
      [...packs].sort((a, b) => key(a).localeCompare(key(b)));

    expect(sorted(withoutSplit)).toEqual(sorted(registry));
  });

  it("links English quests' four CurseForge packs", () => {
    const split = (loadPacks() as RegistryPack[])
      .filter((pack) => pack.section === "quests" && pack.lang === "enUS" && pack.pack !== "all")
      .map((pack) => pack.slug)
      .sort();
    const english = PACKS.find((pack) => pack.section === "quests" && pack.lang === "enUS");
    expect(english?.split?.map((part) => part.slug).sort()).toEqual(split);
  });
});
