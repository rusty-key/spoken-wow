/**
 * The batch path, against a real Postgres, for the reasons ../route.test.ts gives.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { MAX_ENVELOPES } from "@/lib/contributions/saved-variables";

const afterResponse = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", () => ({ after: (task: () => unknown) => afterResponse.push(task) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/npc/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/npc/resolve")>();
  return { ...actual, resolveNpc: vi.fn(async () => undefined) };
});

import { checksum } from "@/lib/contributions/envelope";
import { resolveNpc } from "@/lib/npc/resolve";

import { POST } from "./route";

const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");
const quests = fixture("quests-accept.txt");
const readables = fixture("readables-page.txt");
const places = fixture("places-subzone.txt");

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/batch", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

/** A gossip line from npc 9123, checksummed the way the addon's writer does. */
function gossip(words: string): string {
  const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.1.0\nbuild=1.60.1/69913\nlocale=enUS\nnpc=9123 Tester\nkind=creature\ntext<<\n${words}\n>>\n`;
  return `${body}sum=${checksum(body)}\n`;
}

const installId = crypto.randomUUID();

afterEach(async () => {
  vi.mocked(resolveNpc).mockClear();
  afterResponse.length = 0;
  await db().query(`delete from "missing_audio_hit" where "installId" = $1`, [installId]);
  await db().query(`delete from "contribution_hit" where "installId" = $1`, [installId]);
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution_hit" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/contributions/batch", () => {
  it("stores every good envelope and counts the rest by reason", async () => {
    const response = await POST(
      post({ envelopes: [quests, readables, places, quests.replace("9123", "9124"), 7], name: "Tester" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accepted: 2,
      known: 0,
      counted: 0,
      refused: { describe: 1, checksum: 1, malformed: 1 },
    });

    const { rows } = await db().query<{ source: string; name: string }>(
      `select "source", "name" from "contribution" where "ip" = $1 order by "source"`,
      [ip],
    );
    expect(rows).toEqual([
      { source: "quests", name: "Tester" },
      { source: "readables", name: "Tester" },
    ]);
  });

  it("thanks for a line the corpus already has and stores nothing for it", async () => {
    const questId = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
    const lineId = `q:${questId}:accept`;
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text", "originalText")
       values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', split_part($1, ':', 2)::int, $1, $2, $2)`,
      [lineId, "Kill six.$B$BThen come back, $n."],
    );
    try {
      const envelope = (text: string) => {
        const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.1.0\nbuild=1.60.1/69913\nlocale=enUS\nquest=${questId}\nevent=accept\nnpc=9123 Tester\nkind=creature\ntitle=Test\ntext<<\n${text}\n>>\n`;
        return `${body}sum=${checksum(body)}\n`;
      };
      const response = await POST(
        post({ envelopes: [envelope("Kill six.\n\nThen come back, $N."), envelope("Kill seven.\n\nThen come back, $N.")] }),
      );
      expect(await response.json()).toEqual({ ok: true, accepted: 2, known: 1, counted: 0, refused: {} });

      const { rows } = await db().query<{ text: string }>(`select "text" from "contribution" where "ip" = $1`, [ip]);
      expect(rows.map((row) => row.text)).toEqual(["Kill seven.\n\nThen come back, $N."]);
    } finally {
      await db().query(`delete from "quest_line" where "lineId" = $1`, [lineId]);
    }
  });

  it("refuses a line Postgres cannot store and keeps the rest of the file", async () => {
    const response = await POST(post({ envelopes: [gossip("Hail."), gossip("Fare\u0000well.")] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 1, refused: { malformed: 1 } });
  });

  it("resolves each speaker once, however many of their lines arrive", async () => {
    await POST(post({ envelopes: [gossip("Hail."), gossip("Farewell."), gossip("Well met.")] }));
    expect(resolveNpc).not.toHaveBeenCalled();
    for (const task of afterResponse.splice(0)) await task();
    expect(resolveNpc).toHaveBeenCalledTimes(1);
  });

  it("counts two copies of one line in a file as two sends", async () => {
    const noted = (extra: string) => {
      const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.1.0\nbuild=1.60.1/69913\nlocale=enUS\nquest=9123\nevent=accept\n${extra}title=Dup\ntext<<\nThe same words twice.\n>>\n`;
      return `${body}sum=${checksum(body)}\n`;
    };
    const response = await POST(post({ envelopes: [noted(""), noted("npc=9123 Tester\nkind=creature\n")], name: "Tester" }));
    expect(await response.json()).toMatchObject({ accepted: 2, known: 0 });

    const { rows } = await db().query<{ id: number; count: number; npc: string | null }>(
      `select "id", "count", "meta"->>'npc' as "npc" from "contribution" where "ip" = $1`,
      [ip],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, npc: "9123 Tester" });
    const senders = await db().query(`select 1 from "contribution_sender" where "contributionId" = $1`, [rows[0]?.id]);
    expect(senders.rows).toHaveLength(2);
  });

  it("counts one upload as one hit against the shared limit", async () => {
    await POST(post({ envelopes: [quests, readables] }));
    const hits = await db().query(`select 1 from "contribution_hit" where "ip" = $1`, [ip]);
    expect(hits.rows).toHaveLength(1);
  });

  it("refuses once the hour's allowance is spent", async () => {
    for (let i = 0; i < 10; i++) await POST(post({ envelopes: [readables] }));
    expect((await POST(post({ envelopes: [readables] }))).status).toBe(429);
  });

  it("refuses an empty upload and an oversized one", async () => {
    expect((await POST(post({ envelopes: [] }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ envelopes: Array(MAX_ENVELOPES + 1).fill(readables) }))).status).toBe(413);
  });

  it("answers a filled honeypot with 200 and writes nothing", async () => {
    expect((await POST(post({ envelopes: [quests], website: "x" }))).status).toBe(200);
    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });
});

describe("POST /api/contributions/batch from the manager", () => {
  const questId = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
  const lineId = `q:${questId}:accept`;

  /** A gathered accept panel the corpus has, heard with the given pack. */
  function heard(pack: string, packVersion?: string, text = "Kill six.\n\nThen come back, $N."): string {
    const version = packVersion ? `packVersion=${packVersion}\n` : "";
    const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.1.0\nbuild=1.60.1/69913\nlocale=enUS\npack=${pack}\n${version}quest=${questId}\nevent=accept\nnpc=9123 Tester\nkind=creature\ntitle=Test\ntext<<\n${text}\n>>\n`;
    return `${body}sum=${checksum(body)}\n`;
  }

  async function hits() {
    const { rows } = await db().query<{ lineId: string; packLang: string; packVersion: string | null }>(
      `select "lineId", "packLang", "packVersion" from "missing_audio_hit" where "installId" = $1 order by "packLang"`,
      [installId],
    );
    return rows;
  }

  beforeAll(async () => {
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text", "originalText")
       values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', split_part($1, ':', 2)::int, $1, $2, $2)`,
      [lineId, "Kill six.$B$BThen come back, $n."],
    );
  });

  afterAll(async () => {
    await db().query(`delete from "quest_line" where "lineId" = $1`, [lineId]);
  });

  it("counts a known line once per line, pack language and install", async () => {
    const response = await POST(post({ envelopes: [heard("enUS", "2.3.0"), heard("deDE", "none")], installId }));
    expect(await response.json()).toEqual({ ok: true, accepted: 2, known: 2, counted: 2, refused: {} });
    expect(await hits()).toEqual([
      { lineId, packLang: "deDE", packVersion: "none" },
      { lineId, packLang: "enUS", packVersion: "2.3.0" },
    ]);

    await POST(post({ envelopes: [heard("enUS", "2.4.0")], installId }));
    expect(await hits()).toEqual([
      { lineId, packLang: "deDE", packVersion: "none" },
      { lineId, packLang: "enUS", packVersion: "2.4.0" },
    ]);
  });

  it("stores an unknown line as a contribution, as without an install id", async () => {
    const response = await POST(post({ envelopes: [heard("enUS", "2.3.0", "Kill seven.")], installId }));
    expect(await response.json()).toMatchObject({ known: 0, counted: 0 });
    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(1);
    expect(await hits()).toEqual([]);
  });

  it("keeps a line from an addon that predates packVersion, without one", async () => {
    await POST(post({ envelopes: [heard("enUS")], installId }));
    expect(await hits()).toEqual([{ lineId, packLang: "enUS", packVersion: null }]);
  });

  it("counts nothing without an install id, and ignores one that is not a UUID", async () => {
    await POST(post({ envelopes: [heard("enUS", "2.3.0")] }));
    const response = await POST(post({ envelopes: [heard("enUS", "2.3.0")], installId: "not-an-id" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ known: 1, counted: 0 });
    const { rows } = await db().query(`select 1 from "missing_audio_hit" where "lineId" = $1`, [lineId]);
    expect(rows).toEqual([]);
  });

  it("refuses an install past its own allowance while the IP still has room", async () => {
    for (let i = 0; i < 4; i++) await POST(post({ envelopes: [readables], installId }));
    expect((await POST(post({ envelopes: [readables], installId }))).status).toBe(429);
    expect((await POST(post({ envelopes: [readables] }))).status).toBe(200);
  });
});
