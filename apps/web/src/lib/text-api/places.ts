import "server-only";

import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { catalogue, type CatalogueEntry } from "@/lib/places/catalogue";
import { restoreLore, retireLore, saveLore } from "@/lib/places/lore";

import { catalogueReads, nameVersionOf, nameVersions } from "./catalogue-page";
import { Refused } from "./errors";
import type { NameTarget, SectionApi, TextItem } from "./types";

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

  ...catalogueReads(catalogue, itemsOf, (e, f) => f.zone === undefined || e.mapID === Number(f.zone)),

  async saveText({ lang, id, text, short, note, by, expectedVersion, audit }) {
    const current = (await textVersions(lang, [id])).get(id);
    const full = text ?? current?.full;
    if (full === undefined) throw new Refused("this place has no text yet in this language, so short needs text alongside it");
    // saveLore counts any short it is handed as a change, even a blank one that only asks for the
    // short to be made again, and a rerun must not spend a version.
    const wanted = short?.trim() || null;
    const unchanged = full.trim() === current?.full && wanted === current?.short;
    const saved = await saveLore({
      lang,
      lineId: id,
      full,
      short: unchanged ? null : wanted,
      note,
      editedBy: by,
      expectedVersion,
      audit,
    });
    return { version: saved.version, lines: [id], wrote: saved.wrote };
  },

  async nameTarget(_lang, id) {
    return { kind: id.startsWith("s:") ? "subzone" : "zone", entityId: id };
  },

  async version(lang, id) {
    return (await textVersions(lang, [id])).get(id)?.version ?? null;
  },

  restore: (lang, id, _variant, version, by) => restoreLore(id, version, lang, by),

  retire: (lang, id, _variant, version, by) => retireLore(id, version, lang, by),
};
