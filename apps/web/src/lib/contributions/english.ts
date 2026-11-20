/**
 * The English line each contribution translates, for the review page's side-by-side and checks.
 *
 * Read only, and batched: one query for every quest moment (momentTexts, English's template with
 * its placeholders), one for every greeting (BroadcastText, which holds each language's text
 * under one id). Readables and places are answered by the caller, from what the page already
 * loads. A contribution in English has no English original to compare with, and gets none.
 */
import "server-only";

import { db } from "@/lib/db";
import { BASE_LANG, clientLang } from "@/lib/lang";

import { readable } from "./compare";
import { momentNamed, momentTexts } from "./known";
import type { Contribution } from "./store";

export async function englishFor(rows: readonly Contribution[]): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  const translated = rows.filter((row) => row.source === "quests" && (clientLang(row.locale) ?? BASE_LANG) !== BASE_LANG);

  const moments = translated.flatMap((row) => {
    const moment = momentNamed(row);
    return moment ? [{ row, moment }] : [];
  });
  if (moments.length > 0) {
    const texts = await momentTexts([...new Set(moments.map(({ moment }) => moment))].map((moment) => ({ locale: BASE_LANG, moment })));
    for (const { row, moment } of moments) {
      // The plain wording first (momentTexts orders `:w` wordings after it).
      const line = texts.get(`${BASE_LANG}|${moment}`)?.[0];
      if (line) found.set(row.id, line.text);
    }
  }

  const greetings = translated.filter((row) => momentNamed(row) === null && row.text?.trim());
  if (greetings.length > 0) {
    const { rows: matched } = await db().query<{ id: number; text: string }>(
      // The English form at the same place as the one the greeting matched: `text` and `text1` are
      // the male and female wordings, so a `text1` match was sent from the female one. Matched by
      // the language-keyed readings (migration 0123): a separate `b."lang" = m."lang"` lets the
      // planner take the lang btree and run the readings over the whole language per greeting.
      `select distinct on (m."id") m."id",
              case when gossip_norm(m."text") = any(gossip_readings(b."text"))
                   then coalesce(nullif(e."text", ''), e."text1")
                   else coalesce(nullif(e."text1", ''), e."text") end as "text"
         from unnest($1::int[], $2::text[], $3::text[]) as m ("id", "lang", "text")
         join "broadcast_text" b
           on gossip_lang_readings(b."lang", b."text", b."text1") @> array[gossip_lang_key(m."lang", m."text")]
         join "broadcast_text" e on e."lang" = $4 and e."broadcastTextId" = b."broadcastTextId"
        order by m."id", b."broadcastTextId"`,
      [greetings.map((row) => row.id), greetings.map((row) => clientLang(row.locale) ?? row.locale), greetings.map((row) => row.text), BASE_LANG],
    );
    for (const row of matched) if (row.text) found.set(row.id, row.text);
  }
  // English templates break lines with `$B`: shown, and checked, as the line breaks they are.
  for (const [id, text] of found) found.set(id, readable(text));
  return found;
}
