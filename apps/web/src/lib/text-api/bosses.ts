/** Bosses through the API: boss_line for the story, entity_name for the name. */
import "server-only";

import { catalogue, type BossEntry } from "@/lib/bosses/catalogue";
import { parseBossLineId, restoreStory, retireStory, saveStory } from "@/lib/bosses/story";
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { nameVersionOf, nameVersions, pageOf } from "./catalogue-page";
import { keyOf, type NameTarget, type SectionApi, type TextItem } from "./types";

function targetOf(entry: BossEntry): NameTarget {
  return { kind: "boss", entityId: String(entry.bossId) };
}

async function itemsOf(lang: Lang, entries: BossEntry[]): Promise<TextItem[]> {
  const [versions, names, english] = await Promise.all([
    query<{ bossId: number; version: number }>(
      `select "bossId", "version" from "boss_line" where "lang" = $1 and "isCurrent" and "bossId" = any($2)`,
      [lang, entries.map((e) => e.bossId)],
    ),
    nameVersions(lang, entries.map(targetOf)),
    catalogue(BASE_LANG),
  ]);
  const version = new Map(versions.map((row) => [row.bossId, row.version]));
  const englishText = new Map(english.map((e) => [e.id, e.text]));
  return entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    version: version.get(entry.bossId) ?? null,
    name: entry.nameMissing ? null : entry.name,
    nameVersion: nameVersionOf(names, targetOf(entry)),
    englishText: englishText.get(entry.id) ?? null,
    englishName: entry.englishName ?? entry.name,
    group: { bossId: entry.bossId, map: entry.map, instanceName: entry.instanceName },
  }));
}

export const bosses: SectionApi = {
  filters: { instance: /^-?\d+$/ },

  async list(lang, filter, cursor, limit) {
    const entries = await catalogue(lang);
    const wanted = filter.instance === undefined ? entries : entries.filter((e) => e.map === Number(filter.instance));
    const page = pageOf(wanted, cursor, limit);
    return { items: await itemsOf(lang, page.entries), nextCursor: page.nextCursor };
  },

  async one(lang, id) {
    const entry = (await catalogue(lang)).find((e) => e.id === id);
    return entry ? (await itemsOf(lang, [entry]))[0] : null;
  },

  async known(lang, keys) {
    const ids = new Set((await catalogue(lang)).map((e) => e.id));
    return new Set(keys.filter((k) => ids.has(k.id)).map((k) => keyOf(k.id, k.variant)));
  },

  async saveText({ lang, id, text, note, by, expectedVersion, audit }) {
    const saved = await saveStory({ lang, lineId: id, text: text ?? "", note, editedBy: by, expectedVersion, audit });
    return { version: saved.version, lines: [id] };
  },

  async nameTarget(_lang, id) {
    const parsed = parseBossLineId(id);
    if (!parsed) return null;
    const [row] = await query<{ id: number }>(`select "id" from "boss" where "map" = $1 and "key" = $2`, [
      parsed.map,
      parsed.key,
    ]);
    return row ? { kind: "boss", entityId: String(row.id) } : null;
  },

  async version(lang, id) {
    const parsed = parseBossLineId(id);
    if (!parsed) return null;
    const [row] = await query<{ version: number }>(
      `select l."version" from "boss_line" l join "boss" b on b."id" = l."bossId"
        where b."map" = $1 and b."key" = $2 and l."lang" = $3 and l."isCurrent"`,
      [parsed.map, parsed.key, lang],
    );
    return row?.version ?? null;
  },

  async restore(lang, id, _variant, version, by) {
    await restoreStory(id, version, lang, by);
  },

  retire: (lang, id, _variant, version, by) => retireStory(id, version, lang, by),
};
