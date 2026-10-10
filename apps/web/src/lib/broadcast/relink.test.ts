/**
 * Relinking gossip lines, against a real Postgres. Every line, speaker and BroadcastText row
 * here is this test's own, with ids far outside the game's, and relinking is limited to them.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { relinkGossip } from "./relink";

const base = 960_000_000 + Math.floor(Math.random() * 30_000_000);
const bt = base;
const npc = base;
const HASH = `g:${"a".repeat(24)}${base.toString(16).padStart(8, "0")}`;
const BROADCAST = `g:b${bt}-tauren-male-warrior`;
const LOCALIZED = `g:ptBR-${"c".repeat(24)}${base.toString(16).padStart(8, "0")}`;
const LINES = [HASH, BROADCAST, LOCALIZED];

afterEach(async () => {
  await db().query(`delete from "gossip_merge" where "lineId" = any($1) or "mergedInto" = any($1)`, [LINES]);
  await db().query(`delete from "gossip_broadcast" where "lineId" = any($1)`, [LINES]);
  await db().query(`delete from "broadcast_text" where "broadcastTextId" = $1`, [bt]);
  await db().query(`delete from "quest_line_speaker" where "lineId" = any($1)`, [LINES]);
  await db().query(`delete from "quest_line" where "lineId" = any($1)`, [LINES]);
  await db().query(`delete from "entity_name" where "kind" = 'creature' and "entityId" = any($1::text[])`, [
    [String(npc), String(npc + 1)],
  ]);
});

afterAll(closeDb);

/** A current gossip row, and its speaker in the same language. */
async function line(lineId: string, lang: string, text: string, opts: { speaker?: number; createdAt?: string } = {}) {
  const english = lang === "enUS";
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
        "text", "originalText", "localeText", "createdAt")
     values ($1, 0, $2, 1, true, 'contributed', 'gossip', $3, $4, $4, $5, $6)`,
    [lineId, lang, lineId.slice(2), text, english ? null : text, opts.createdAt ?? new Date().toISOString()],
  );
  await db().query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
     select $1, 0, $2, coalesce(max("ord"), 0) + 1, 'creature', $3, 'Test Speaker', 'tauren', 'male', 'warrior',
            'tauren-male-warrior'
       from "quest_line_speaker" where "lang" = $2`,
    [lineId, lang, opts.speaker ?? npc],
  );
}

async function speaks(lineId: string, id: number) {
  await db().query(`insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy") values ($1, $2, 'text')`, [
    lineId,
    id,
  ]);
}

async function current(lineId: string) {
  const { rows } = await db().query<{ lang: string; text: string; fileName: string }>(
    `select "lang", "text", "fileName" from "quest_line" where "lineId" = $1 and "isCurrent" order by "lang"`,
    [lineId],
  );
  return rows;
}

describe("relinkGossip", () => {
  it("gives a line with no id the one its own language's text reads as", async () => {
    await line(LOCALIZED, "ptBR", "Olá, $gviajante:viajanta;.");
    await db().query(
      `insert into "broadcast_text" ("lang", "broadcastTextId", "text", "text1", "build") values ('ptBR', $1, $2, '', 1)`,
      [bt, "  olá,   $Gviajante:viajanta;."],
    );
    await db().query(`update "quest_line" set "localeText" = 'Olá, viajante.' where "lineId" = $1`, [LOCALIZED]);

    expect(await relinkGossip({ lineIds: LINES })).toMatchObject({ linked: 1 });
    const { rows } = await db().query(`select "broadcastTextId" from "gossip_broadcast" where "lineId" = $1`, [LOCALIZED]);
    expect(rows).toEqual([{ broadcastTextId: bt }]);
  });

  it("merges a moment minted twice into the line named by its id, renaming nothing", async () => {
    await line(BROADCAST, "ptBR", "Bem-vindo.", { createdAt: "2026-10-02T00:00:00Z" });
    await line(HASH, "enUS", "Welcome.", { createdAt: "2026-10-01T00:00:00Z" });
    await line(HASH, "ptBR", "Bem-vindo.");
    await db().query(`delete from "quest_line_speaker" where "lineId" = $1 and "lang" = 'ptBR'`, [HASH]);
    await speaks(BROADCAST, bt);
    await speaks(HASH, bt);

    expect(await relinkGossip({ lineIds: LINES })).toEqual({ linked: 0, merges: [[HASH, BROADCAST]] });
    expect(await current(BROADCAST)).toEqual([
      { lang: "enUS", text: "Welcome.", fileName: BROADCAST.slice(2) },
      { lang: "ptBR", text: "Bem-vindo.", fileName: BROADCAST.slice(2) },
    ]);
    expect(await current(HASH)).toEqual([]);
    const { rows: speakers } = await db().query(
      `select "lang" from "quest_line_speaker" where "lineId" = $1 order by 1`,
      [BROADCAST],
    );
    expect(speakers.map((row) => row.lang)).toEqual(["enUS", "ptBR"]);
    const { rows: merged } = await db().query(`select "mergedInto" from "gossip_merge" where "lineId" = $1`, [HASH]);
    expect(merged).toEqual([{ mergedInto: BROADCAST }]);

    expect(await relinkGossip({ lineIds: LINES })).toEqual({ linked: 0, merges: [] });
  });

  it("leaves lines of one moment that read differently", async () => {
    await line(BROADCAST, "ptBR", "Bem-vindo.");
    await line(HASH, "ptBR", "Bem-vindo de novo.");
    await speaks(BROADCAST, bt);
    await speaks(HASH, bt);
    expect((await relinkGossip({ lineIds: LINES })).merges).toEqual([]);
  });

  it("leaves lines of one moment that other NPCs speak", async () => {
    await line(BROADCAST, "ptBR", "Bem-vindo.");
    await line(HASH, "ptBR", "Bem-vindo.", { speaker: npc + 1 });
    await speaks(BROADCAST, bt);
    await speaks(HASH, bt);
    expect((await relinkGossip({ lineIds: LINES })).merges).toEqual([]);
  });
});
