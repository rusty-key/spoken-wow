// A minted page later found in the world database: its texts, takes, reports and contributions
// move to the real page, and the minted row stays behind as an alias so a pack that shipped it
// still plays. Audio files are not renamed: a take keeps the file it was cut to.

import { isGeneratable, normaliseText } from "./text.mjs";

const norm = (t) => normaliseText(t).trim();

/** Shorter than this, a page's words are too common to say two pages are one. */
export const MIN_MATCH_LENGTH = 20;

const distinctive = (t) => norm(t).length >= MIN_MATCH_LENGTH && isGeneratable(t).generatable;

export function findAbsorptions(minted, extracted) {
  const candidates = new Map();
  for (const page of minted) {
    const hits = new Set();
    for (const [lang, text] of Object.entries(page.texts)) {
      if (!distinctive(text)) continue;
      for (const real of extracted) if (real.texts[lang] !== undefined && norm(real.texts[lang]) === norm(text)) hits.add(real.lineId);
    }
    if (hits.size === 1) candidates.set(page.lineId, [...hits][0]);
  }
  const claims = new Map();
  for (const to of candidates.values()) claims.set(to, (claims.get(to) ?? 0) + 1);
  return [...candidates].filter(([, to]) => claims.get(to) === 1).map(([from, to]) => ({ from, to }));
}

/** Moves everything keyed on `from` to `to`, in the caller's transaction. */
export async function absorb(client, { from, to }) {
  // A language the real page already has keeps its own text; the minted one's becomes history.
  await client.query(
    `update "book_line" m set "isCurrent" = false
      where m."lineId" = $1 and exists (select 1 from "book_line" r where r."lineId" = $2 and r."lang" = m."lang" and r."isCurrent")`,
    [from, to],
  );
  await client.query(
    `update "book_line" m
        set "lineId" = $2,
            "version" = m."version" + coalesce((select max(r."version") from "book_line" r where r."lineId" = $2 and r."lang" = m."lang"), 0)
      where m."lineId" = $1`,
    [from, to],
  );
  for (const table of ["take", "report", "recording"]) {
    await client.query(`update "${table}" set "lineId" = $2 where "lineId" = $1 and "source" = 'readables'`, [from, to]);
  }
  // Both pages may have had a current take in one language; the newer stays current.
  await client.query(
    `update "take" set "isCurrent" = false
      where "lineId" = $1 and "source" = 'readables' and "isCurrent"
        and "id" <> (select max(t."id") from "take" t
                      where t."lineId" = $1 and t."source" = 'readables' and t."isCurrent" and t."lang" = "take"."lang")`,
    [to],
  );
  await client.query(`update "regeneration_job" set "lineId" = $2 where "lineId" = $1 and "source" = 'readables'`, [from, to]);
  await client.query(`update "contribution" set "matchLineId" = $2 where "matchLineId" = $1`, [from, to]);
  await client.query(`update "book_page" set "aliasOf" = $2 where "lineId" = $1`, [from, to]);
  // A moderator's "this is a page of that book", once the minted book has no live page left,
  // is the real page's book.
  await client.query(
    `update "contribution" c set "matchBookId" = r."bookId"
       from "book_page" m, "book_page" r
      where m."lineId" = $1 and r."lineId" = $2 and c."matchBookId" = m."bookId" and m."bookId" <> r."bookId"
        and not exists (select 1 from "book_page" o where o."bookId" = m."bookId" and o."aliasOf" is null)`,
    [from, to],
  );
}

/**
 * Every minted page whose words turn out to be a real page's, folded into it, in the caller's
 * transaction. Returns how many were.
 *
 * A minted page that does not fold but sits where the extract now places a real page moves to
 * the end of its book, so the place is the real page's and book_page_place holds at commit.
 */
export async function foldMinted(client) {
  const { rows } = await client.query(
    `select p."lineId", p."pageTextId" is null as "minted", jsonb_object_agg(l."lang", l."text") as "texts"
       from "book_page" p join "book_line" l on l."lineId" = p."lineId" and l."isCurrent"
      where p."aliasOf" is null
      group by p."lineId", p."pageTextId"`,
  );
  const absorptions = findAbsorptions(rows.filter((p) => p.minted), rows.filter((p) => !p.minted));
  for (const move of absorptions) await absorb(client, move);

  await client.query(
    `update "book_page" p set "pageNumber" = d."next"
       from (select m."lineId",
                    (select max(o."pageNumber") from "book_page" o where o."bookId" = m."bookId" and o."aliasOf" is null)
                      + row_number() over (partition by m."bookId" order by m."pageNumber") as "next"
               from "book_page" m
               join "book_page" r on r."bookId" = m."bookId" and r."pageNumber" = m."pageNumber"
                                 and r."pageTextId" is not null and r."aliasOf" is null
              where m."pageTextId" is null and m."aliasOf" is null) d
      where p."lineId" = d."lineId"`,
  );
  return absorptions.length;
}
