/**
 * Quest lines through the API, gossip among them.
 *
 * Read from quest_line rather than corpus(): the corpus has no variant, reads only variant 0 of
 * a translation, and repeats a line once per speaker, none of which suits an item addressed by
 * id. What is listed matches the corpus's rule otherwise: a language's own rows, then English's
 * for the moments it has none of, so an English split shows as :m and :f until translated.
 */
import "server-only";

import { momentOf, momentSql, answersQuestMomentSql } from "@/lib/contributions/naming";
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender } from "@/lib/player-words";
import { saveQuestText } from "@/lib/quests/text";

import { BadCursor, decodeCursor, encodeCursor, keyOf, type SectionApi, type TextItem } from "./types";

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

/** `where` and `limit` slot into the outer query, with $1 the language and $2 English. */
function linesSql(where: string, limit: string): string {
  return `
    with "own" as (
      select "id", "lineId", "variant", ${momentSql(`"lineId"`)} as "moment" from "quest_line"
       where "lang" = $1 and "isCurrent"
    ), "lines" as (
      select "lineId", "variant", "moment", "id" as "ownId" from "own"
      union all
      select e."lineId", e."variant", ${momentSql(`e."lineId"`)}, null from "quest_line" e
       where e."lang" = $2 and e."isCurrent"
         and not exists (select 1 from "own" o
                          where o."moment" = ${momentSql(`e."lineId"`)} and o."variant" = e."variant")
    ), "items" as (
      select ln."lineId", ln."variant", ln."moment", ln."ownId",
             coalesce(t."source", e."source") as "source",
             coalesce(t."questId", e."questId") as "questId",
             coalesce(t."playerGender", e."playerGender") as "playerGender",
             t."text", t."version", e."text" as "englishText", e."questTitle" as "englishTitle"
        from "lines" ln
        left join "quest_line" t on t."id" = ln."ownId"
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
     ${where}
     order by i."lineId" collate "C", i."variant"
     ${limit}`;
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

function cursorOf(cursor: string): [string, number] {
  const decoded = decodeCursor(cursor);
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== "string" ||
    !Number.isInteger(decoded[1])
  ) {
    throw new BadCursor("that cursor is not one this API gave out");
  }
  return decoded as [string, number];
}

export const quests: SectionApi = {
  filters: { quest: /^\d+$/, source: /^(accept|progress|complete|gossip)$/ },

  async list(lang, filter, cursor, limit) {
    const params: unknown[] = [lang, BASE_LANG];
    const where: string[] = [];
    const add = (value: unknown) => `$${params.push(value)}`;
    if (filter.quest !== undefined) where.push(`i."questId" = ${add(Number(filter.quest))}`);
    if (filter.source !== undefined) where.push(`i."source" = ${add(filter.source)}`);
    if (cursor !== null) {
      const [id, variant] = cursorOf(cursor);
      where.push(`(i."lineId" collate "C", i."variant") > (${add(id)} collate "C", ${add(variant)}::smallint)`);
    }
    const rows = await query<Row>(
      linesSql(where.length ? `where ${where.join(" and ")}` : "", `limit ${add(limit + 1)}`),
      params,
    );
    const items = rows.slice(0, limit).map(toItem);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit ? encodeCursor([last.id, last.variant]) : null };
  },

  async one(lang, id, variant) {
    const rows = await query<Row>(linesSql(`where i."lineId" = $3 and i."variant" = $4`, ""), [
      lang,
      BASE_LANG,
      id,
      variant,
    ]);
    return rows[0] ? toItem(rows[0]) : null;
  },

  async known(lang, keys) {
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
    const gendered = branchesOnPlayerGender(body);
    const moment = momentOf(id);
    const current = () =>
      query<{ lineId: string }>(
        `select "lineId" from "quest_line"
          where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"`,
        [moment, variant, lang],
      );
    // Two plain saves to the sides of an untranslated split would land on one plain line, and
    // the second would silently overwrite the first.
    if (id !== moment && !gendered && !(await current()).length) {
      throw new Error("this moment splits by player gender and has no text yet: send one text with a $G branch");
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
    return { version: saved.version, lines: gendered ? (await current()).map((row) => row.lineId) : [id] };
  },

  async nameTarget(lang, id, variant) {
    const item = await quests.one(lang, id, variant);
    const questId = item?.group.questId;
    return questId === null || questId === undefined ? null : { kind: "quest", entityId: String(questId) };
  },
};
