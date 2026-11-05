/**
 * Gossip lines are among these. Read from quest_line rather than corpus(): the corpus has no variant, reads only variant 0 of
 * a translation, and repeats a line once per speaker, none of which suits an item addressed by
 * id. What is listed matches the corpus's rule otherwise: a language's own rows, then English's
 * for the moments it has none of, so an English split shows as :m and :f until translated.
 */
import { LEVEL_PARAM } from "@/lib/line-fields";
import "server-only";

import { audioRelPath } from "@/lib/audio";
import { momentOf, momentSql, answersQuestMomentSql } from "@/lib/contributions/naming";
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender } from "@/lib/player-words";
import { overrideOf, type LineOverride } from "@/lib/quests/override";
import { readOverrides } from "@/lib/quests/overrides";
import { restoreQuestText, retireQuestText, saveQuestText } from "@/lib/quests/text";

import { Refused } from "./errors";
import { decodeCursor, encodeCursor, hasNul, isVariant, keyOf, type SectionApi, type TextItem } from "./types";

type Row = {
  lineId: string;
  variant: number;
  source: string;
  questId: number | null;
  playerGender: string | null;
  text: string | null;
  version: number | null;
  fileName: string;
  name: string | null;
  nameVersion: number | null;
  englishText: string | null;
  englishName: string | null;
};

/**
 * $1 is the language and $2 English. `scope` limits the rows read at the start, given the alias to
 * read them under, because one quest must not pay for a pass over a whole language. `where` and
 * `limit` pick the page before the joins, under the alias `ln`, so each row's text and English are
 * looked up once per item.
 *
 * Text stays out of the "own" rows because they are materialised for the anti-join, where a whole
 * language's text spills to disk. The anti-join compares under "C" since an equality needs no
 * locale, whose sort is most of a page's time.
 */
function linesSql(where: string, limit: string, scope: (alias: string) => string): string {
  return `
    with "own" as (
      select o."lineId", o."variant", ${momentSql(`o."lineId"`)} as "moment",
             o."source", o."questId", o."playerGender"
        from "quest_line" o
       where o."lang" = $1 and o."isCurrent" and ${scope("o")}
    ), "lines" as (
      select * from "own"
      union all
      select e."lineId", e."variant", ${momentSql(`e."lineId"`)}, e."source", e."questId", e."playerGender"
        from "quest_line" e
       where e."lang" = $2 and e."isCurrent" and ${scope("e")}
         and not exists (select 1 from "own" o
                          where o."moment" collate "C" = ${momentSql(`e."lineId"`)} collate "C" and o."variant" = e."variant")
    ), "page" as (
      select * from "lines" ln
       ${where}
       order by ln."lineId" collate "C", ln."variant"
       ${limit}
    )
    select ln."lineId", ln."variant", ln."source", ln."questId", ln."playerGender", t."text", t."version",
           coalesce(t."fileName", e."fileName") as "fileName", n."name", n."version" as "nameVersion", e."text" as "englishText",
           coalesce(en."name", e."questTitle") as "englishName"
      from "page" ln
      left join "quest_line" t
        on t."lineId" = ln."lineId" and t."variant" = ln."variant" and t."lang" = $1 and t."isCurrent"
      left join lateral (
        select * from "quest_line" e
         where e."lineId" = any(array[ln."lineId", ln."moment", ln."moment" || ':m'])
           and e."variant" = ln."variant" and e."lang" = $2 and e."isCurrent"
         order by e."lineId" = ln."lineId" desc, e."lineId" = ln."moment" desc
         limit 1
      ) e on true
      left join "entity_name" n
        on n."kind" = 'quest' and n."entityId" = ln."questId"::text and n."lang" = $1 and n."isCurrent"
      left join "entity_name" en
        on en."kind" = 'quest' and en."entityId" = ln."questId"::text and en."lang" = $2 and en."isCurrent"
     order by ln."lineId" collate "C", ln."variant"`;
}

function toItem(row: Row, overrides: Map<string, LineOverride>): TextItem {
  return {
    id: row.lineId,
    variant: row.variant,
    text: row.text,
    override: overrideOf(overrides, audioRelPath(row))?.text ?? null,
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
  const minLevel = filter.minLevel === undefined ? null : add(Number(filter.minLevel));
  const maxLevel = filter.maxLevel === undefined ? null : add(Number(filter.maxLevel));
  const levelBounds = [
    ...(minLevel ? [`"level" >= ${minLevel}::int`] : []),
    ...(maxLevel ? [`"level" <= ${maxLevel}::int`] : []),
  ].join(" and ");
  const scope = (alias: string) =>
    [
      ...(quest ? [`${alias}."questId" = ${quest}::int`] : []),
      ...(source ? [`${alias}."source" = ${source}`] : []),
      ...(levelBounds
        ? [`${alias}."questId" in (select "questId" from "quest_level" where ${levelBounds})`]
        : []),
    ].join(" and ") || "true";
  const after = cursor === null ? null : decodeCursor(cursor, isCursor);
  const where = after
    ? `where (ln."lineId" collate "C", ln."variant") > (${add(after[0])} collate "C", ${add(after[1])}::smallint)`
    : "";
  return { text: linesSql(where, `limit ${add(limit + 1)}`, scope), params };
}

export const quests: SectionApi = {
  filters: {
    quest: /^\d{1,9}$/,
    source: /^(accept|progress|complete|gossip)$/,
    minLevel: LEVEL_PARAM,
    maxLevel: LEVEL_PARAM,
  },

  async list(lang, filter, cursor, limit) {
    const { text, params } = listSql(filter, cursor, limit, lang);
    const [rows, overrides] = await Promise.all([query<Row>(text, params), readOverrides(lang)]);
    const items = rows.slice(0, limit).map((row) => toItem(row, overrides));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit ? encodeCursor([last.id, last.variant]) : null };
  },

  async one(lang, id, variant) {
    if (hasNul(id)) return null;
    const [rows, overrides] = await Promise.all([
      query<Row>(
        linesSql(`where ln."lineId" = $3 and ln."variant" = $4`, "", (alias) =>
          answersQuestMomentSql(`${alias}."lineId"`, "$5"),
        ),
        [lang, BASE_LANG, id, variant, momentOf(id)],
      ),
      readOverrides(lang),
    ]);
    return rows[0] ? toItem(rows[0], overrides) : null;
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
    if (lang === BASE_LANG) throw new Refused("English quest text cannot be changed here");
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
        throw new Refused("this moment splits by player gender and has no text yet: send one text with a $G branch");
      }
    }
    return saveQuestText({
      lang,
      lineId: id,
      variant,
      text: body,
      note,
      editedBy: by,
      expectedVersion,
      audit,
    });
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
