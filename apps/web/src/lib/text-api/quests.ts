/**
 * Gossip lines are among these. Read from quest_line rather than corpus(): the corpus has no variant, reads only variant 0 of
 * a translation, and repeats a line once per speaker, none of which suits an item addressed by
 * id. What is listed matches the corpus's rule otherwise: a language's own rows, then English's
 * for the moments it has none of, so an English split shows as :m and :f until translated.
 */
import "server-only";

import { momentOf, momentSql, answersQuestMomentSql } from "@/lib/contributions/naming";
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender } from "@/lib/player-words";
import { restoreQuestText, retireQuestText, saveQuestText } from "@/lib/quests/text";

import { decodeCursor, encodeCursor, hasNul, isVariant, keyOf, type SectionApi, type TextItem } from "./types";

type Row = {
  lineId: string;
  variant: number;
  source: string;
  questId: number | null;
  playerGender: string | null;
  text: string | null;
  version: number | null;
  name: string | null;
  nameVersion: number | null;
  englishText: string | null;
  englishName: string | null;
};

/**
 * $1 is the language and $2 English. `scope` limits the rows read at the start, given the alias to
 * read them under, because one quest must not pay for a pass over a whole language. `where` and
 * `limit` pick the page before the joins, under the alias `ln`, so a page pays for its own rows'
 * English and names rather than a whole language's.
 *
 * The own rows carry their text with them: joining quest_line back by id scans the whole table,
 * every language, and spills to disk on a small host.
 */
function linesSql(where: string, limit: string, scope: (alias: string) => string): string {
  return `
    with "own" as (
      select o."lineId", o."variant", ${momentSql(`o."lineId"`)} as "moment",
             o."source", o."questId", o."playerGender", o."text", o."version"
        from "quest_line" o
       where o."lang" = $1 and o."isCurrent" and ${scope("o")}
    ), "lines" as (
      select "lineId", "variant", "moment", "source", "questId", "playerGender", "text", "version" from "own"
      union all
      select e."lineId", e."variant", ${momentSql(`e."lineId"`)}, e."source", e."questId", e."playerGender", null, null
        from "quest_line" e
       where e."lang" = $2 and e."isCurrent" and ${scope("e")}
         and not exists (select 1 from "own" o
                          where o."moment" = ${momentSql(`e."lineId"`)} and o."variant" = e."variant")
    ), "page" as (
      select * from "lines" ln
       ${where}
       order by ln."lineId" collate "C", ln."variant"
       ${limit}
    ), "items" as (
      select ln.*, e."text" as "englishText", e."questTitle" as "englishTitle"
        from "page" ln
        left join lateral (
          select * from "quest_line" e
           where e."lineId" = any(array[ln."lineId", ln."moment", ln."moment" || ':m'])
             and e."variant" = ln."variant" and e."lang" = $2 and e."isCurrent"
           order by e."lineId" = ln."lineId" desc, e."lineId" = ln."moment" desc
           limit 1
        ) e on true
    )
    select i."lineId", i."variant", i."source", i."questId", i."playerGender", i."text", i."version",
           n."name", n."version" as "nameVersion", i."englishText",
           coalesce(en."name", i."englishTitle") as "englishName"
      from "items" i
      left join "entity_name" n
        on n."kind" = 'quest' and n."entityId" = i."questId"::text and n."lang" = $1 and n."isCurrent"
      left join "entity_name" en
        on en."kind" = 'quest' and en."entityId" = i."questId"::text and en."lang" = $2 and en."isCurrent"
     order by i."lineId" collate "C", i."variant"`;
}

function toItem(row: Row): TextItem {
  return {
    id: row.lineId,
    variant: row.variant,
    text: row.text,
    version: row.version,
    name: row.name,
    nameVersion: row.nameVersion,
    englishText: row.englishText,
    englishName: row.englishName,
    group: { source: row.source, questId: row.questId, playerGender: row.playerGender },
  };
}

function isCursor(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && !hasNul(value[0]) && isVariant(value[1])
  );
}

/** Exported so a test can read what the database is asked to do. */
export function listSql(
  filter: Record<string, string>,
  cursor: string | null,
  limit: number,
  lang: Lang,
): { text: string; params: unknown[] } {
  const params: unknown[] = [lang, BASE_LANG];
  const add = (value: unknown) => `$${params.push(value)}`;
  const quest = filter.quest === undefined ? null : add(Number(filter.quest));
  const source = filter.source === undefined ? null : add(filter.source);
  const scope = (alias: string) =>
    [
      ...(quest ? [`${alias}."questId" = ${quest}::int`] : []),
      ...(source ? [`${alias}."source" = ${source}`] : []),
    ].join(" and ") || "true";
  const after = cursor === null ? null : decodeCursor(cursor, isCursor);
  const where = after
    ? `where (ln."lineId" collate "C", ln."variant") > (${add(after[0])} collate "C", ${add(after[1])}::smallint)`
    : "";
  return { text: linesSql(where, `limit ${add(limit + 1)}`, scope), params };
}

export const quests: SectionApi = {
  filters: { quest: /^\d{1,9}$/, source: /^(accept|progress|complete|gossip)$/ },

  async list(lang, filter, cursor, limit) {
    const { text, params } = listSql(filter, cursor, limit, lang);
    const rows = await query<Row>(text, params);
    const items = rows.slice(0, limit).map(toItem);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit ? encodeCursor([last.id, last.variant]) : null };
  },

  async one(lang, id, variant) {
    if (hasNul(id)) return null;
    const rows = await query<Row>(
      linesSql(`where ln."lineId" = $3 and ln."variant" = $4`, "", (alias) =>
        answersQuestMomentSql(`${alias}."lineId"`, "$5"),
      ),
      [lang, BASE_LANG, id, variant, momentOf(id)],
    );
    return rows[0] ? toItem(rows[0]) : null;
  },

  async known(lang, asked) {
    const keys = asked.filter((k) => !hasNul(k.id));
    if (!keys.length) return new Set();
    const rows = await query<{ lineId: string; variant: number }>(
      `with "wanted" as (
         select * from unnest($3::text[], $4::smallint[]) as w("lineId", "variant")
       )
       select w."lineId", w."variant" from "wanted" w
        where exists (select 1 from "quest_line" o
                       where o."lineId" = w."lineId" and o."variant" = w."variant"
                         and o."lang" = $1 and o."isCurrent")
           or (exists (select 1 from "quest_line" e
                        where e."lineId" = w."lineId" and e."variant" = w."variant"
                          and e."lang" = $2 and e."isCurrent")
               and not exists (select 1 from "quest_line" o
                                where ${answersQuestMomentSql(`o."lineId"`, momentSql(`w."lineId"`))}
                                  and o."variant" = w."variant" and o."lang" = $1 and o."isCurrent"))`,
      [lang, BASE_LANG, keys.map((k) => k.id), keys.map((k) => k.variant)],
    );
    return new Set(rows.map((row) => keyOf(row.lineId, row.variant)));
  },

  async saveText({ lang, id, variant, text, note, by, expectedVersion, audit }) {
    const body = text ?? "";
    const moment = momentOf(id);
    // Two plain saves to the sides of an untranslated split would land on one plain line, and
    // the second would silently overwrite the first.
    if (id !== moment && !branchesOnPlayerGender(body)) {
      const rows = await query(
        `select 1 from "quest_line"
          where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"`,
        [moment, variant, lang],
      );
      if (!rows.length) {
        throw new Error("this moment splits by player gender and has no text yet: send one text with a $G branch");
      }
    }
    const saved = await saveQuestText({
      lang,
      lineId: id,
      variant,
      text: body,
      note,
      editedBy: by,
      expectedVersion,
      audit,
    });
    return { version: saved.version, lines: saved.lines, wrote: saved.wrote };
  },

  async nameTarget(lang, id, variant) {
    const [row] = await query<{ questId: number | null }>(
      `select "questId" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = any($3) and "isCurrent"
        order by "lang" = $4 desc limit 1`,
      [id, variant, [lang, BASE_LANG], lang],
    );
    return row?.questId === null || row?.questId === undefined
      ? null
      : { kind: "quest", entityId: String(row.questId) };
  },

  async version(lang, id, variant) {
    const [row] = await query<{ version: number }>(
      `select "version" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [id, variant, lang],
    );
    return row?.version ?? null;
  },

  restore: (lang, id, variant, version, by) => restoreQuestText(id, variant, lang, version, by),

  retire: (lang, id, variant, version, by) => retireQuestText(id, variant, lang, version, by),
};
