/**
 * An admin adding an NPC as one more speaker of a line, taking one off, and putting one in
 * another's place.
 *
 * Needs DATABASE_URL and migrations applied (0076 and 0077 in particular). Every line, speaker and NPC
 * here is this run's own, numbered far outside anything the game files.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { upsertResolution } from "@/lib/npc/store";
import { corpus } from "@/lib/quests/catalogue";

const ADMIN = "test-quests-speakers-route";
let admin = true;

vi.mock("@/lib/generation/authz", () => ({
  requireAdmin: async (request: Request) => {
    const lang = new URL(request.url).searchParams.get("lang") || "enUS";
    return admin
      ? { lang, session: { user: { id: ADMIN } }, denied: null }
      : { lang: null, session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) };
  },
}));

import { DELETE, GET, POST } from "./route";

const base = 990_000_000 + Math.floor(Math.random() * 9_000_000);
const questId = base;
const giver = base + 1;
const second = base + 2;
const ORD = 1_900_000_000 + Math.floor(Math.random() * 100_000_000);
const LINE = `q:${questId}:accept`;

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Speakers Admin', $2, false)
     on conflict ("id") do nothing`,
    [ADMIN, `${ADMIN}@example.invalid`],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "quest_line_speaker" where "lineId" like $1`, [`q:${questId}:%`]);
  await asSystem.query(`delete from "quest_line_speaker_removed" where "moment" like $1`, [`q:${questId}:%`]);
  await asSystem.query(`delete from "quest_line" where "lineId" like $1`, [`q:${questId}:%`]);
  await asSystem.query(`delete from "npc" where "npcId" between $1 and $2`, [base, base + 10]);
  await asSystem.query(
    `delete from "entity_name" where ("kind" = 'quest' and "entityId" = $1) or ("kind" = 'creature' and "entityId" = any($2::text[]))`,
    [String(questId), [giver, second].map(String)],
  );
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [ADMIN]);
  await asSystem.query(`delete from "contribution" where "ip" = $1`, [IP]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [ADMIN]);
  await closeDb();
});

async function answer(npcId: number, race: string, gender: string | null, flavor: string | null): Promise<void> {
  await upsertResolution({
    npcKind: "creature",
    npcId,
    npcName: `Speaker ${npcId}`,
    race,
    gender,
    flavor,
    provenance: "moderator",
    confirmed: true,
    doubtful: false,
    modelFileId: null,
    sex: null,
    creatureType: null,
    build: null,
    note: null,
    resolvedBy: ADMIN,
  });
}

/** An English quest line spoken by `giver`, as an import writes it; `split` gives it :m and :f sides. */
async function line(split = false): Promise<void> {
  const ids = split ? [`${LINE}:m`, `${LINE}:f`] : [LINE];
  for (const [i, lineId] of ids.entries()) {
    await asSystem.query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "fileName", "text", "originalText", "generatable")
       values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'A Test Quest', $3,
               'Bring me six wolf pelts.', 'Bring me six wolf pelts.', true)`,
      [lineId, questId, lineId.replaceAll(":", "-")],
    );
    await asSystem.query(
      `insert into "quest_line_speaker"
         ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
       values ($1, 0, 'enUS', $2, 'creature', $3, 'Giver', 'human', 'male', 'standard', 'human-male-standard')`,
      [lineId, ORD + i, giver],
    );
  }
}

async function speakers(): Promise<{ lineId: string; npcId: number; addedBy: string | null; ord: number }[]> {
  const { rows } = await asSystem.query(
    `select "lineId", "npcId", "addedBy", "ord" from "quest_line_speaker"
      where "lineId" like $1 order by "lineId", "ord"`,
    [`q:${questId}:%`],
  );
  return rows;
}

async function removals(): Promise<[string, number, string][]> {
  const { rows } = await asSystem.query<{ moment: string; npcId: number; removedBy: string }>(
    `select "moment", "npcId", "removedBy" from "quest_line_speaker_removed" where "moment" like $1 order by 1, 2`,
    [`q:${questId}:%`],
  );
  return rows.map((row) => [row.moment, row.npcId, row.removedBy]);
}

const IP = `test-speakers-${base}`;

/** Marks `npcId`'s rows as a contribution's, as accepting one writes them. */
async function contributed(npcId: number): Promise<void> {
  const { rows } = await asSystem.query<{ id: number }>(
    `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
     values ('quests', $1, 'raw', $2, 'Bring me six wolf pelts.', $3) returning "id"`,
    [LINE, `${IP}-${npcId}`, IP],
  );
  await asSystem.query(
    `update "quest_line_speaker" set "contributionId" = $1 where "lineId" like $2 and "npcId" = $3`,
    [rows[0].id, `q:${questId}:%`, npcId],
  );
}

function post(body: unknown): Request {
  return new Request("https://example.com/api/quests/lines/speakers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(lineId: string, npcId: number): Request {
  return new Request(
    `https://example.com/api/quests/lines/speakers?lineId=${encodeURIComponent(lineId)}&npcType=creature&npcId=${npcId}`,
    { method: "DELETE" },
  );
}

describe("POST /api/quests/lines/speakers", () => {
  it("refuses anyone but an admin", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    admin = false;
    try {
      expect((await POST(post({ lineId: LINE, npcType: "creature", npcId: second }))).status).toBe(403);
    } finally {
      admin = true;
    }
    expect(await speakers()).toHaveLength(1);
  });

  it("adds an answered NPC as one more speaker, marked and clear of the extract's numbering", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    expect((await POST(post({ lineId: LINE, npcType: "creature", npcId: second }))).status).toBe(200);

    const rows = await speakers();
    expect(rows.map((row) => [row.npcId, row.addedBy])).toEqual([
      [giver, null],
      [second, ADMIN],
    ]);
    expect(rows[1].ord).toBeGreaterThanOrEqual(1_000_000);
  });

  it("gives the added NPC its own voice's line in the catalogue, missing until generated", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));

    const lines = (await corpus()).lines.filter((l) => l.questId === questId);
    expect(lines.map((l) => [l.lineId, l.npcId, l.added ?? false])).toEqual([
      [LINE, giver, false],
      [`${LINE}~orc-male-shady`, second, true],
    ]);
    expect(lines.every((l) => !l.soleSpeaker)).toBe(true);
  });

  it("adds it to both sides of a line split by player gender, from either side", async () => {
    await line(true);
    await answer(second, "orc", "male", "shady");
    expect((await POST(post({ lineId: `${LINE}:f~human-male-standard`, npcType: "creature", npcId: second }))).status).toBe(200);

    const added = (await speakers()).filter((row) => row.npcId === second).map((row) => row.lineId);
    expect(added).toEqual([`${LINE}:f`, `${LINE}:m`]);
  });

  it("refuses an NPC that already speaks the line", async () => {
    await line();
    await answer(giver, "human", "male", "standard");
    expect((await POST(post({ lineId: LINE, npcType: "creature", npcId: giver }))).status).toBe(409);
    expect(await speakers()).toHaveLength(1);
  });

  it("refuses a line nobody speaks", async () => {
    await answer(second, "orc", "male", "shady");
    expect((await POST(post({ lineId: LINE, npcType: "creature", npcId: second }))).status).toBe(404);
  });

  it("refuses an NPC with no type", async () => {
    await line();
    const response = await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));
    expect(response.status).toBe(400);
    expect(await speakers()).toHaveLength(1);
  });
});

describe("GET /api/quests/lines/speakers", () => {
  it("looks an NPC up with its voice", async () => {
    await answer(second, "orc", "male", "shady");
    const response = await GET(new Request(`https://example.com/api/quests/lines/speakers?npcType=creature&npcId=${second}`));
    const body = await response.json();
    expect(body.npc).toMatchObject({ npcName: `Speaker ${second}`, race: "orc", voice: "orc-male-shady" });
    expect(body.roster).toBeNull();
  });

  it("answers null for an NPC nobody has answered, and hands the roster over to answer it", async () => {
    const response = await GET(new Request(`https://example.com/api/quests/lines/speakers?npcType=creature&npcId=${second}`));
    const body = await response.json();
    expect(body.npc).toBeNull();
    expect(body.roster.races.length).toBeGreaterThan(0);
  });
});

describe("DELETE /api/quests/lines/speakers", () => {
  it("takes back a speaker added by hand, on every side of the line", async () => {
    await line(true);
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));

    const response = await DELETE(del(`${LINE}:m`, second));
    expect(await response.json()).toEqual({ removed: 2 });
    expect((await speakers()).map((row) => row.npcId)).toEqual([giver, giver]);
  });

  it("refuses to remove a line's last speaker", async () => {
    await line();
    const response = await DELETE(del(LINE, giver));
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("last");
    expect(await speakers()).toHaveLength(1);
  });

  it("removes a speaker the dump has while another speaks the line, and records it for the import", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));

    expect(await (await DELETE(del(LINE, giver))).json()).toEqual({ removed: 1 });
    expect((await speakers()).map((row) => row.npcId)).toEqual([second]);
    expect(await removals()).toEqual([[LINE, giver, ADMIN]]);
  });

  it("leaves the line's file in its old voice, so the next speaker keeps its own voice's line", async () => {
    await line();
    await answer(giver, "human", "male", "standard");
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));
    await DELETE(del(LINE, giver));

    const lines = (await corpus()).lines.filter((l) => l.questId === questId);
    expect(lines.map((l) => [l.lineId, l.npcId])).toEqual([[`${LINE}~orc-male-shady`, second]]);
  });

  it("refuses to leave a language without a speaker, whatever another language has", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await asSystem.query(
      `insert into "quest_line_speaker"
         ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
       values ($1, 0, 'deDE', $2, 'creature', $3, 'Zweiter', 'orc', 'male', 'shady', 'orc-male-shady')`,
      [LINE, ORD + 50, second],
    );
    const response = await DELETE(del(LINE, giver));
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("last");
  });

  it("forgets the removal once the speaker is added back", async () => {
    await line();
    await answer(giver, "human", "male", "standard");
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));
    await DELETE(del(LINE, giver));

    expect((await POST(post({ lineId: LINE, npcType: "creature", npcId: giver }))).status).toBe(200);
    expect(await removals()).toEqual([]);
  });

  it("removes a contribution's speaker like any other, and records it for the import", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));
    await contributed(giver);

    expect(await (await DELETE(del(LINE, giver))).json()).toEqual({ removed: 1 });
    expect((await speakers()).map((row) => row.npcId)).toEqual([second]);
    expect(await removals()).toEqual([[LINE, giver, ADMIN]]);
  });
});

describe("POST /api/quests/lines/speakers with replaces", () => {
  function replace(npcId: number, replaces: number): Request {
    return post({ lineId: LINE, npcType: "creature", npcId, replaces: { npcType: "creature", npcId: replaces } });
  }

  it("puts the NPC in the dump's speaker's place, on every side of the line", async () => {
    await line(true);
    await answer(second, "orc", "male", "shady");
    expect((await POST(replace(second, giver))).status).toBe(200);

    const rows = await speakers();
    expect(rows.map((row) => [row.lineId, row.npcId, row.addedBy])).toEqual([
      [`${LINE}:f`, second, ADMIN],
      [`${LINE}:m`, second, ADMIN],
    ]);
    expect(await removals()).toEqual([[LINE, giver, ADMIN]]);
  });

  it("gives the new NPC its own voice's line, missing until generated", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await POST(replace(second, giver));

    const lines = (await corpus()).lines.filter((l) => l.questId === questId);
    expect(lines.map((l) => [l.lineId, l.npcId])).toEqual([[`${LINE}~orc-male-shady`, second]]);
    expect(lines[0].soleSpeaker).toBe(true);
  });

  it("refuses when the old NPC no longer speaks the line, adding nobody", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    const response = await POST(replace(second, giver + 5));
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toBe("gone");
    expect((await speakers()).map((row) => row.npcId)).toEqual([giver]);
  });

  it("only removes the old speaker when the new one already speaks the line", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await POST(post({ lineId: LINE, npcType: "creature", npcId: second }));
    expect((await POST(replace(second, giver))).status).toBe(200);
    expect((await speakers()).map((row) => row.npcId)).toEqual([second]);
  });

  it("refuses an NPC with no type, and leaves the line as it was", async () => {
    await line();
    expect((await POST(replace(second, giver))).status).toBe(400);
    expect((await speakers()).map((row) => row.npcId)).toEqual([giver]);
  });

  it("replaces a contribution's speaker like any other", async () => {
    await line();
    await answer(second, "orc", "male", "shady");
    await contributed(giver);
    expect((await POST(replace(second, giver))).status).toBe(200);
    expect((await speakers()).map((row) => row.npcId)).toEqual([second]);
  });
});
