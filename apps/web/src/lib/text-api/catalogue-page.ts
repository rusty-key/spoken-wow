/**
 * Paging over a catalogue, which each worker already holds in memory for the site: sorting and
 * slicing it costs far less than asking the database for a language's lines per page.
 */
import "server-only";

import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { decodeCursor, encodeCursor, keyOf, type NameTarget, type SectionApi, type TextItem } from "./types";

/** Code units, the order Postgres' `collate "C"` agrees with, so a cursor means one place. */
function pageOf<T extends { id: string }>(
  entries: readonly T[],
  cursor: string | null,
  limit: number,
): { entries: T[]; nextCursor: string | null } {
  const after = cursor === null ? null : decodeCursor(cursor, (value): value is string => typeof value === "string");
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after === null ? sorted : sorted.filter((entry) => entry.id > after);
  const slice = rest.slice(0, limit);
  return {
    entries: slice,
    nextCursor: rest.length > limit ? encodeCursor(slice[slice.length - 1].id) : null,
  };
}

export function catalogueReads<T extends { id: string }>(
  read: (lang: Lang) => Promise<readonly T[]>,
  itemsOf: (lang: Lang, entries: T[]) => Promise<TextItem[]>,
  matches: (entry: T, filter: Record<string, string>) => boolean,
): Pick<SectionApi, "list" | "one" | "known"> {
  return {
    async list(lang, filter, cursor, limit) {
      const page = pageOf((await read(lang)).filter((entry) => matches(entry, filter)), cursor, limit);
      return { items: await itemsOf(lang, page.entries), nextCursor: page.nextCursor };
    },
    async one(lang, id) {
      const entry = (await read(lang)).find((e) => e.id === id);
      return entry ? (await itemsOf(lang, [entry]))[0] : null;
    },
    async known(lang, keys) {
      const ids = new Set((await read(lang)).map((e) => e.id));
      return new Set(keys.filter((k) => ids.has(k.id)).map((k) => keyOf(k.id, k.variant)));
    },
  };
}

/** Keyed `${kind}:${entityId}`. */
export async function nameVersions(lang: Lang, targets: readonly (NameTarget | null)[]): Promise<Map<string, number>> {
  const present = targets.filter((target): target is NameTarget => target !== null);
  if (!present.length) return new Map();
  const rows = await query<{ kind: string; entityId: string; version: number }>(
    `select n."kind", n."entityId", n."version"
       from unnest($2::text[], $3::text[]) as wanted("kind", "entityId")
       join "entity_name" n on n."kind" = wanted."kind" and n."entityId" = wanted."entityId"
      where n."lang" = $1 and n."isCurrent"`,
    [lang, present.map((t) => t.kind), present.map((t) => t.entityId)],
  );
  return new Map(rows.map((row) => [`${row.kind}:${row.entityId}`, row.version]));
}

export function nameVersionOf(versions: Map<string, number>, target: NameTarget | null): number | null {
  return target ? (versions.get(`${target.kind}:${target.entityId}`) ?? null) : null;
}
