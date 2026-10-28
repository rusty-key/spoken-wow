import data from "@/data/boss-lore.json";

import type { Lang } from "@/lib/lang";

type Localized = Partial<Record<Lang, string>>;
type RawBoss = (typeof data.bosses)[number];

export type BossLore = {
  id: string;
  map: number;
  key: string;
  name: string;
  dungeon: string;
  story: string;
  translated: boolean;
};

function text(values: Localized, lang: Lang): string {
  return values[lang] ?? values.enUS ?? "";
}

function view(row: RawBoss, lang: Lang): BossLore {
  const stories = row.stories as Localized;
  const story = text(stories, lang);
  return {
    id: `${row.map}:${row.key}`,
    map: row.map,
    key: row.key,
    name: text(row.names as Localized, lang),
    dungeon: text(row.dungeons as Localized, lang) || "World bosses",
    story,
    translated: Boolean(stories[lang]),
  };
}

export function bossesFor(lang: Lang): BossLore[] {
  return data.bosses
    .map((row) => view(row, lang))
    .sort((a, b) => a.dungeon.localeCompare(b.dungeon) || a.name.localeCompare(b.name));
}

export function bossLoreCount(): number {
  return data.bosses.length;
}
