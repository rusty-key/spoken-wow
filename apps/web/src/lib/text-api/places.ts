/** Places through the API: lore_line for the words, entity_name for what a place is called. */
import "server-only";

import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { catalogue, type CatalogueEntry } from "@/lib/places/catalogue";
import { saveLore } from "@/lib/places/lore";

import { nameVersionOf, nameVersions, pageOf } from "./catalogue-page";
import { keyOf, type NameTarget, type SectionApi, type TextItem } from "./types";

function targetOf(entry: CatalogueEntry): NameTarget {
  return { kind: entry.kind, entityId: entry.id };
}

async function textVersions(lang: Lang, ids: string[]) {
  const rows = await query<{ lineId: string; version: number; full: string; short: string }>(
    `select "lineId", "version", "full", "short" from "lore_line"
      where "lang" = $1 and "isCurrent" and "lineId" = any($2)`,
    [lang, ids],
  );
  return new Map(rows.map((row) => [row.lineId, row]));
}

async function itemsOf(lang: Lang, entries: CatalogueEntry[]): Promise<TextItem[]> {
  const [versions, names] = await Promise.all([
    textVersions(lang, entries.map((e) => e.id)),
    nameVersions(lang, entries.map(targetOf)),
  ]);
  return entries.map((entry) => {
    const translated = lang === BASE_LANG || !entry.missing?.text;
    const named = lang === BASE_LANG || !entry.missing?.name;
    const row = versions.get(entry.id);
    return {
      id: entry.id,
      text: translated ? entry.full : null,
      short: translated ? (row?.short ?? entry.short) : null,
      version: translated ? (row?.version ?? null) : null,
      name: named ? entry.name : null,
      nameVersion: nameVersionOf(names, targetOf(entry)),
      englishText: lang === BASE_LANG ? entry.full : (entry.english ?? null),
      englishName: lang === BASE_LANG ? entry.name : (entry.englishName ?? null),
      group: { kind: entry.kind, mapID: entry.mapID, zoneName: entry.zoneName },
    };
  });
}

export const places: SectionApi = {
  filters: { zone: /^-?\d+$/ },

  async list(lang, filter, cursor, limit) {
    const entries = await catalogue(lang);
    const wanted = filter.zone === undefined ? entries : entries.filter((e) => e.mapID === Number(filter.zone));
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

  async saveText({ lang, id, text, short, note, by, expectedVersion, audit }) {
    const current = (await textVersions(lang, [id])).get(id);
    const full = text ?? current?.full;
    if (full === undefined) throw new Error("this place has no text yet in this language, so short needs text alongside it");
    // saveLore counts any short it is handed as a change, and a rerun must not spend a version.
    const unchanged = full.trim() === current?.full && short?.trim() === current?.short;
    const saved = await saveLore({
      lang,
      lineId: id,
      full,
      short: unchanged ? null : short,
      note,
      editedBy: by,
      expectedVersion,
      audit,
    });
    return { version: saved.version, lines: [id] };
  },

  async nameTarget(_lang, id) {
    return { kind: id.startsWith("s:") ? "subzone" : "zone", entityId: id };
  },

  async version(lang, id) {
    return (await textVersions(lang, [id])).get(id)?.version ?? null;
  },
};
