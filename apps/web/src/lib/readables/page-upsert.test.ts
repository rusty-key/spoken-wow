/**
 * bookPageUpsert against a real Postgres, where the readables pipeline has no database harness.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { bookPageUpsert } from "@readables-tools/lib/page.mjs";

const n = 800_000_000 + Math.floor(Math.random() * 90_000_000);
const PAGE = `b:${n}`;

const extract = (ownerKind: string, ownerIds: number[]) => ({
  lineId: PAGE, pageId: n, bookId: n, pageNumber: 1, ownerKind, ownerIds, material: 0,
});

async function upsert(ownerKind: string, ownerIds: number[]) {
  const { text, values } = bookPageUpsert(extract(ownerKind, ownerIds));
  await db().query(text, values);
}

async function owners() {
  const { rows } = await db().query(`select "ownerKind", "ownerIds" from "book_page" where "lineId" = $1`, [PAGE]);
  return rows[0];
}

afterEach(async () => {
  await db().query(`delete from "book_page" where "lineId" = $1`, [PAGE]);
});
afterAll(closeDb);

describe("bookPageUpsert", () => {
  it("keeps an owner a contribution added after the extract's own", async () => {
    await upsert("object", [5]);
    await db().query(`update "book_page" set "ownerIds" = array_append("ownerIds", 9) where "lineId" = $1`, [PAGE]);
    await upsert("object", [7, 5]);
    expect(await owners()).toEqual({ ownerKind: "object", ownerIds: [7, 5, 9] });
  });

  it("takes the extract's owners when they are of the other kind", async () => {
    await upsert("object", [5]);
    await upsert("item", [3]);
    expect(await owners()).toEqual({ ownerKind: "item", ownerIds: [3] });
  });
});
