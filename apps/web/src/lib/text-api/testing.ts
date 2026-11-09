/**
 * For tests: one line in each section and a user to write them as. A test database may hold
 * quest lines only, so the other sections' rows are built here, and a quest line is borrowed
 * from whichever English line `LANG` has not translated.
 */
import { bossLineId } from "@/lib/bosses/story";
import { asSystem, testUser } from "@/lib/teams/testing";

/** Tests elsewhere already wipe this language, so nothing real is at stake in it. */
export const LANG = "koKR";

export type Fixtures = {
  user: string;
  map: number;
  zone: string;
  subzone: string;
  boss: { lineId: string; id: number; map: number };
  page: { lineId: string; bookId: string; ownerId: number };
  ownerlessPage: { lineId: string; bookId: string };
  quest: { lineId: string; variant: number; questId: number };
  gossip: { lineId: string; variant: number };
  remove(): Promise<void>;
};

const random = () => Math.random().toString(36).slice(2, 10);

function randomInt(): number {
  return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

async function seedPage(lineId: string, bookId: string, owner: number | null): Promise<void> {
  const pageTextId = randomInt();
  const kind = owner === null ? null : "item";
  const ownerIds = owner === null ? null : [owner];
  await asSystem.query(
    `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds", "material")
     values ($1, $2, $3, 1, $4, $5::integer[], 0)`,
    [lineId, pageTextId, bookId, kind, ownerIds],
  );
  await asSystem.query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId", "pageNumber", "pageCount",
        "title", "ownerKind", "ownerIds", "material", "text", "generatable")
     values ($1, 'enUS', 1, true, 'extracted', $2, 1, 1, 1, 'A Test Tome', $3, $4::integer[], 0, 'English page.', true)`,
    [lineId, pageTextId, kind, ownerIds],
  );
}

export async function createFixtures(): Promise<Fixtures> {
  const { id: user, cleanup: removeUser } = await testUser("test-api");

  const map = -randomInt();
  const zone = `z:${map}`;
  const subzone = `s:${map}:test-key`;
  for (const [lineId, kind, key, name] of [
    [zone, "zone", null, "Testlands"],
    [subzone, "subzone", "test-key", "Test Hollow"],
  ] as const) {
    await asSystem.query(
      `insert into "lore_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key", "name", "full", "short")
       values ($1, 'enUS', 1, true, 'scraped', $2, $3, $4, $5, 'English lore.', 'English.')`,
      [lineId, map, kind, key, name],
    );
    await asSystem.query(
      `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
       values ($1, $2, 'enUS', 1, true, 'extracted', $3)
       on conflict do nothing`,
      [kind, lineId, name],
    );
  }

  const bossId = -randomInt();
  const bossKey = `boss-${random()}`;
  await asSystem.query(`insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, 0)`, [
    map,
  ]);
  await asSystem.query(`insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`, [
    bossId,
    map,
    bossKey,
    [bossId],
  ]);
  await asSystem.query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ('boss', $1, 'enUS', 1, true, 'extracted', 'Test Boss')`,
    [String(bossId)],
  );

  const ownerId = randomInt();
  const page = { lineId: `b:${randomInt()}`, bookId: `test-${random()}`, ownerId };
  await seedPage(page.lineId, page.bookId, ownerId);
  await asSystem.query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ('item', $1, 'enUS', 1, true, 'extracted', 'A Test Tome')
     on conflict do nothing`,
    [String(ownerId)],
  );
  const ownerlessPage = { lineId: `b:${randomInt()}`, bookId: `test-${random()}` };
  await seedPage(ownerlessPage.lineId, ownerlessPage.bookId, null);

  const untranslated = async (source: string, questId: string) => {
    const { rows } = await asSystem.query<{ lineId: string; variant: number; questId: number }>(
      `select "lineId", "variant", "questId" from "quest_line" e
        where "lang" = 'enUS' and "isCurrent" and "source" = $2 and "questId" is ${questId}
          and "lineId" !~ ':[mf]$'
          and not exists (select 1 from "quest_line" k
                           where k."lineId" in (e."lineId", e."lineId" || ':m', e."lineId" || ':f') and k."lang" = $1)
        order by "lineId" limit 1`,
      [LANG, source],
    );
    if (!rows[0]) throw new Error(`createFixtures needs an English ${source} line ${LANG} has not translated`);
    return rows[0];
  };

  return {
    user,
    map,
    zone,
    subzone,
    boss: { lineId: bossLineId(map, bossKey), id: bossId, map },
    page,
    ownerlessPage,
    quest: await untranslated("accept", "not null"),
    gossip: await untranslated("gossip", "null"),
    async remove() {
      await asSystem.query(`delete from "activity" where "actorId" = $1`, [user]);
      await asSystem.query(`delete from "lore_line" where "mapID" = $1`, [map]);
      await asSystem.query(
        `delete from "entity_name" where ("kind", "entityId") in
           (('zone', $1), ('subzone', $2), ('boss', $3), ('item', $4))`,
        [zone, subzone, String(bossId), String(ownerId)],
      );
      await asSystem.query(`delete from "boss_line" where "bossId" = $1`, [bossId]);
      await asSystem.query(`delete from "boss" where "map" = $1`, [map]);
      await asSystem.query(`delete from "boss_instance" where "map" = $1`, [map]);
      for (const lineId of [page.lineId, ownerlessPage.lineId]) {
        await asSystem.query(`delete from "book_line" where "lineId" = $1`, [lineId]);
        await asSystem.query(`delete from "book_page" where "lineId" = $1`, [lineId]);
      }
      await removeUser();
    },
  };
}
