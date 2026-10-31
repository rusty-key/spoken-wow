/**
 * The public write path, against a real Postgres.
 *
 * The defences here are the reason this route exists in the shape it does, and every one of
 * them is only observable end to end: a honeypot that returned 400 would still "work" in a
 * unit test of the validator, and a rate limit held in memory would pass one too.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

import { POST } from "./route";

const ip = "203.0.113.99";

/** Written by tests/lua/contribute_envelope_test.lua, as the addon writes a report's context. */
const observed = readFileSync(
  new URL("../../../../../../tests/fixtures/contributions/quests-observed.txt", import.meta.url),
  "utf8",
);

function post(body: unknown): Request {
  return new Request("https://example.com/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

function valid(overrides: Record<string, unknown> = {}) {
  return { target: "quest/1/accept", category: "pronunciation", body: "Wrong.", ...overrides };
}

afterEach(async () => {
  await db().query(`delete from "report" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution_hit" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/reports", () => {
  it("writes a report", async () => {
    expect((await POST(post(valid()))).status).toBe(200);

    const { rows } = await db().query<{ target: string }>(
      `select "target" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe("quest/1/accept");
  });

  it("answers a filled honeypot with 200 and writes nothing", async () => {
    expect((await POST(post(valid({ website: "http://spam.example" })))).status).toBe(200);

    const { rows } = await db().query(`select 1 from "report" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });

  it("rejects an event a quest address cannot carry", async () => {
    expect((await POST(post(valid({ target: "quest/1/gossip" })))).status).toBe(400);
  });

  it("rejects an unknown category", async () => {
    expect((await POST(post(valid({ category: "lore" })))).status).toBe(400);
  });

  it("refuses the eleventh report in an hour", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await POST(post(valid()))).status).toBe(200);
    }

    expect((await POST(post(valid()))).status).toBe(429);
  });

  it("files a readables report against a minted page's key", async () => {
    const key = `n${randomUUID()}`;
    const lineId = `b:${key}`;
    await db().query(
      `insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`,
      [lineId, key],
    );
    try {
      await db().query(
        `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
         values ($1, 'enUS', 1, true, 'contributed', 'Minted', 'Words.')`,
        [lineId],
      );

      expect((await POST(post(valid({ source: "readables", target: key })))).status).toBe(200);

      const { rows } = await db().query<{ lineId: string | null }>(
        `select "lineId" from "report" where "ip" = $1`,
        [ip],
      );
      expect(rows).toEqual([{ lineId }]);
    } finally {
      await db().query(`delete from "book_line" where "lineId" = $1`, [lineId]);
      await db().query(`delete from "book_page" where "lineId" = $1`, [lineId]);
    }
  });

  it("files a report with a folded minted page's key under the real page", async () => {
    const key = `n${randomUUID()}`;
    const mintedId = `b:${key}`;
    const realId = `b:${700_000_000 + Math.floor(Math.random() * 90_000_000)}`;
    const num = Number(realId.slice(2));
    await db().query(
      `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber") values ($1, $2::int, $2::int::text, 1)`,
      [realId, num],
    );
    await db().query(
      `insert into "book_page" ("lineId", "bookId", "pageNumber", "aliasOf") values ($1, $2, 1, $3)`,
      [mintedId, key, realId],
    );
    try {
      await db().query(
        `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
         values ($1, 'enUS', 1, true, 'extracted', 'Real', 'Words.')`,
        [realId],
      );
      expect((await POST(post(valid({ source: "readables", target: key })))).status).toBe(200);
      const { rows } = await db().query(`select "lineId" from "report" where "ip" = $1`, [ip]);
      expect(rows).toEqual([{ lineId: realId }]);
    } finally {
      await db().query(`delete from "book_line" where "lineId" = $1`, [realId]);
      await db().query(`delete from "book_page" where "lineId" = $1`, [mintedId]);
      await db().query(`delete from "book_page" where "lineId" = $1`, [realId]);
    }
  });

  it("files a bosses report against the boss's audio path, and refuses a path no boss owns", async () => {
    const map = -2;
    const id = -Math.floor(1e6 + Math.random() * 1e9);
    const key = `report-${randomUUID().slice(0, 8)}`;
    await db().query(
      `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -2)`,
      [map],
    );
    try {
      await db().query(
        `insert into "boss" ("id", "map", "key", "position", "encounterIds") values ($1, $2, $3, 0, $4)`,
        [id, map, key, [id]],
      );

      expect((await POST(post(valid({ source: "bosses", target: `${map}/nobody-${key}` })))).status).toBe(400);
      // Exactly '<map>/<slug>': a trailing segment is not the same boss under another address.
      expect((await POST(post(valid({ source: "bosses", target: `${map}/${key}/extra` })))).status).toBe(400);
      expect((await POST(post(valid({ source: "bosses", target: `${map}/${key}` })))).status).toBe(200);

      const { rows } = await db().query(`select "lineId", "target" from "report" where "ip" = $1`, [ip]);
      expect(rows).toEqual([{ lineId: `boss:${map}:${key}`, target: `${map}/${key}` }]);
    } finally {
      await db().query(`delete from "boss" where "map" = $1`, [map]);
      await db().query(`delete from "boss_instance" where "map" = $1`, [map]);
    }
  });

  it("stores no lineId when the claimed line does not belong to the target", async () => {
    await POST(post(valid({ lineId: "g:not-a-real-line" })));

    const { rows } = await db().query<{ lineId: string | null }>(
      `select "lineId" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows[0].lineId).toBeNull();
  });

  it("keeps the context the addon sent", async () => {
    expect((await POST(post(valid({ context: observed })))).status).toBe(200);

    const { rows } = await db().query<{ context: { fields: Record<string, string>; text: string } }>(
      `select "context" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows[0].context.fields.addon).toBe("SpokenQuests/2.0.4");
    expect(rows[0].context.fields.npc).toBe("9123 Boarton Shadetotem");
    expect(rows[0].context.text).toBe("We'll need to work on your stealth skills, druid.");
  });

  it("files the report without a context that fails its checks", async () => {
    const tampered = observed.replace("druid", "rogue");
    expect((await POST(post(valid({ context: tampered })))).status).toBe(200);

    const { rows } = await db().query<{ context: unknown }>(
      `select "context" from "report" where "ip" = $1`,
      [ip],
    );
    expect(rows.map((row) => row.context)).toEqual([null]);
  });

  it("contributes the text of a missing line", async () => {
    await POST(post(valid({ category: "missing", body: "Nothing played.", context: observed })));

    const { rows } = await db().query<{ key: string; text: string; body: string }>(
      `select "key", "text", "body" from "contribution" where "ip" = $1`,
      [ip],
    );
    expect(rows).toEqual([
      { key: "76156:progress", text: "We'll need to work on your stealth skills, druid.", body: "Nothing played." },
    ]);
  });

  it("contributes nothing for any other complaint", async () => {
    await POST(post(valid({ category: "pronunciation", context: observed })));

    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });
});
