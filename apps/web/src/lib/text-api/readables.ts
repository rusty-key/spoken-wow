/**
 * A page's name is its owner's, so renaming one page renames everything that shares that owner,
 * and a page with no owner has no name to write.
 */
import "server-only";

import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { baseCatalogue, catalogue, type BookPage } from "@/lib/readables/catalogue";
import { ownerEntityKind, type OwnerKind } from "@/lib/readables/filters";
import { restoreBookText, retireBookText, saveBookText } from "@/lib/readables/text";

import { catalogueReads, nameVersionOf, nameVersions } from "./catalogue-page";
import { saveNarratedOverride } from "./narrated-override";
import type { NameTarget, SectionApi, TextItem } from "./types";

function targetOf(page: Pick<BookPage, "ownerKind" | "ownerIds">): NameTarget | null {
  if (!page.ownerKind || !page.ownerIds.length) return null;
  return { kind: ownerEntityKind(page.ownerKind), entityId: String(page.ownerIds[0]) };
}

async function itemsOf(lang: Lang, pages: BookPage[]): Promise<TextItem[]> {
  const [versions, names] = await Promise.all([
    query<{ lineId: string; version: number }>(
      `select "lineId", "version" from "book_line" where "lang" = $1 and "isCurrent" and "lineId" = any($2)`,
      [lang, pages.map((p) => p.id)],
    ),
    nameVersions(lang, pages.map(targetOf)),
  ]);
  const version = new Map(versions.map((row) => [row.lineId, row.version]));
  return pages.map((page) => {
    const translated = !page.missing?.text;
    return {
      id: page.id,
      text: translated ? page.text : null,
      override: page.override?.text ?? null,
      version: translated ? (version.get(page.id) ?? null) : null,
      name: page.missing?.title ? null : page.title,
      nameVersion: nameVersionOf(names, targetOf(page)),
      englishText: lang === BASE_LANG ? page.text : (page.english ?? null),
      englishName: lang === BASE_LANG ? page.title : (page.englishTitle ?? null),
      group: { bookId: page.bookId, pageNumber: page.pageNumber, pageCount: page.pageCount },
    };
  });
}

async function versionOf(lang: Lang, id: string): Promise<number | null> {
  const [row] = await query<{ version: number }>(
    `select "version" from "book_line" where "lang" = $1 and "isCurrent" and "lineId" = $2`,
    [lang, id],
  );
  return row?.version ?? null;
}

export const readables: SectionApi = {
  filters: { book: /^.+$/ },

  ...catalogueReads(catalogue, itemsOf, (p, f) => f.book === undefined || p.bookId === f.book),

  async saveText({ lang, id, text, note, by, expectedVersion, audit }) {
    const saved = await saveBookText({ lang, lineId: id, text: text ?? "", note, editedBy: by, expectedVersion, audit });
    return { version: saved.version, lines: [id], wrote: saved.wrote };
  },

  async saveOverride(args) {
    const page = (await baseCatalogue(args.lang)).find((p) => p.id === args.id);
    const original = page && !page.missing?.text ? page.text : null;
    return saveNarratedOverride("readables", args, original, await versionOf(args.lang, args.id));
  },

  async nameTarget(_lang, id) {
    const [row] = await query<{ ownerKind: OwnerKind | null; ownerIds: number[] | null }>(
      `select "ownerKind", "ownerIds" from "book_page" where "lineId" = $1`,
      [id],
    );
    return row ? targetOf({ ownerKind: row.ownerKind, ownerIds: row.ownerIds ?? [] }) : null;
  },

  version: versionOf,

  restore: (lang, id, _variant, version, by) => restoreBookText(id, version, lang, by),

  retire: (lang, id, _variant, version, by) => retireBookText(id, version, lang, by),
};
