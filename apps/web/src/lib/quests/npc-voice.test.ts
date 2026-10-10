/**
 * A line's voice, read from its speakers' NPCs (migration 0070). Against a real Postgres,
 * because what is being tested is the catalogue's join.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { corpus } = await import("./catalogue");

const WHOLE_CORPUS = { timeout: 20_000 };

let questId: number;
let lineId: string;
let npcIds: number[];

beforeEach(() => {
  questId = 950_000_000 + Math.floor(Math.random() * 40_000_000);
  lineId = `q:${questId}:accept`;
  npcIds = [questId, questId + 1, questId + 2];
});

afterEach(async () => {
  await db().query(`delete from "quest_line_speaker" where "lineId" = $1`, [lineId]);
  await db().query(`delete from "quest_line" where "lineId" = $1`, [lineId]);
  await db().query(`delete from "npc" where "npcId" = any($1::int[])`, [npcIds]);
  await db().query(`delete from "entity_name" where "entityId" = any($1::text[])`, [npcIds.map(String)]);
});

afterAll(closeDb);

/** An English line spoken by `speakers`, each written with the voice the extract gave it. */
async function line(
  speakers: { npcId: number; race: string; gender: string; flavor: string | null }[],
  source: "accept" | "gossip" = "accept",
) {
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "fileName", "text", "originalText", "generatable")
     values ($1, 0, 'enUS', 1, true, 'extracted', $4, $2, 'A Test Quest', $3,
             'Bring me six wolf pelts.', 'Bring me six wolf pelts.', true)`,
    [lineId, source === "accept" ? questId : null, `${questId}-accept`, source],
  );
  for (const [index, speaker] of speakers.entries()) {
    await db().query(
      `insert into "quest_line_speaker"
         ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
          "flavor", "voice")
       values ($1, 0, 'enUS', $2, 'creature', $3, 'Test Speaker', $4, $5, $6, $7)`,
      [
        lineId, 1_900_000_000 + (questId % 50_000_000) * 3 + index, speaker.npcId,
        speaker.race, speaker.gender, speaker.flavor,
        [speaker.race, speaker.gender, speaker.flavor].filter(Boolean).join("-"),
      ],
    );
  }
}

async function npc(npcId: number, values: { race: string | null; gender: string | null; flavor: string | null; provenance: string }) {
  await db().query(
    `insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed")
     values ('creature', $1, $2, $3, $4, $5, $5 in ('corpus', 'moderator'))`,
    [npcId, values.race, values.gender, values.flavor, values.provenance],
  );
}

/** Each of this line's rows as `lineId fileName voice`, plain or in another voice, by NPC. */
async function spoken(): Promise<string[]> {
  return (await corpus()).lines
    .filter((candidate) => candidate.lineId === lineId || candidate.lineId.startsWith(`${lineId}~`))
    .sort((a, b) => a.npcId - b.npcId)
    .map((l) => `${l.lineId} ${l.fileName} ${l.voice}${l.generatable ? "" : ` (${l.skipReason})`}`);
}

describe("a quest moment's voice", WHOLE_CORPUS, () => {
  it("keeps the file it was made in for an NPC whose voice is the one it was written with", async () => {
    await line([{ npcId: npcIds[0], race: "tauren", gender: "male", flavor: "warrior" }]);
    await npc(npcIds[0], { race: "tauren", gender: "male", flavor: "warrior", provenance: "corpus" });

    expect(await spoken()).toEqual([`${lineId} ${questId}-accept tauren-male-warrior`]);
  });

  it("is a line of its own for an NPC whose voice is another, named after the voice", async () => {
    await line([{ npcId: npcIds[0], race: "tauren", gender: "male", flavor: "warrior" }]);
    await npc(npcIds[0], { race: "tauren", gender: "male", flavor: "elder", provenance: "moderator" });

    expect(await spoken()).toEqual([
      `${lineId}~tauren-male-elder ${questId}-accept-tauren-male-elder tauren-male-elder`,
    ]);
  });

  it("cannot be voiced while its NPC has no flavor", async () => {
    await line([{ npcId: npcIds[0], race: "tauren", gender: "male", flavor: "warrior" }]);
    await npc(npcIds[0], { race: "tauren", gender: "male", flavor: null, provenance: "corpus" });

    expect(await spoken()).toEqual([
      `${lineId}~tauren-male ${questId}-accept-tauren-male tauren-male (no-voice)`,
    ]);
  });

  it("is spoken by NPCs sharing it in each of their own voices, one file per voice", async () => {
    await line(npcIds.map((npcId) => ({ npcId, race: "human", gender: "male", flavor: "official" })));
    await npc(npcIds[0], { race: "human", gender: "male", flavor: "warrior", provenance: "corpus" });
    await npc(npcIds[1], { race: "human", gender: "male", flavor: "official", provenance: "corpus" });
    await npc(npcIds[2], { race: "human", gender: "male", flavor: "warrior", provenance: "corpus" });

    expect(await spoken()).toEqual([
      `${lineId}~human-male-warrior ${questId}-accept-human-male-warrior human-male-warrior`,
      `${lineId} ${questId}-accept human-male-official`,
      `${lineId}~human-male-warrior ${questId}-accept-human-male-warrior human-male-warrior`,
    ]);
  });

  it("cannot be voiced while its NPC has no type, whatever its speaker row says", async () => {
    await line([{ npcId: npcIds[0], race: "orc", gender: "female", flavor: "standard" }]);
    await npc(npcIds[0], { race: null, gender: null, flavor: null, provenance: "none" });

    expect(await spoken()).toEqual([`${lineId} ${questId}-accept orc-female-standard (no-voice)`]);
  });

  it("keeps the narrator's file for an NPC of a generic type the narrator reads", async () => {
    await line([{ npcId: npcIds[0], race: "narrator", gender: "male", flavor: null }]);
    await npc(npcIds[0], { race: "creature", gender: null, flavor: null, provenance: "moderator" });

    expect(await spoken()).toEqual([`${lineId} ${questId}-accept narrator-male`]);
  });
});

describe("a greeting's voice", WHOLE_CORPUS, () => {
  it("is each speaker's own, one file per voice, as a quest moment's is", async () => {
    await line(npcIds.map((npcId) => ({ npcId, race: "human", gender: "male", flavor: "official" })), "gossip");
    await npc(npcIds[0], { race: "human", gender: "male", flavor: "warrior", provenance: "corpus" });
    await npc(npcIds[1], { race: "human", gender: "male", flavor: "official", provenance: "corpus" });
    await npc(npcIds[2], { race: "human", gender: "male", flavor: "official", provenance: "corpus" });

    expect(await spoken()).toEqual([
      `${lineId}~human-male-warrior ${questId}-accept-human-male-warrior human-male-warrior`,
      `${lineId} ${questId}-accept human-male-official`,
      `${lineId} ${questId}-accept human-male-official`,
    ]);
  });
});

describe("the catalogue", WHOLE_CORPUS, () => {
  it("moves when an NPC's answer changes, so the NPC speaks its new voice's line", async () => {
    await line([{ npcId: npcIds[0], race: "tauren", gender: "male", flavor: "warrior" }]);
    await npc(npcIds[0], { race: "tauren", gender: "male", flavor: "warrior", provenance: "moderator" });
    expect(await spoken()).toEqual([`${lineId} ${questId}-accept tauren-male-warrior`]);

    await db().query(
      `update "npc" set "flavor" = 'elder', "updatedAt" = now() where "npcKind" = 'creature' and "npcId" = $1`,
      [npcIds[0]],
    );
    expect(await spoken()).toEqual([
      `${lineId}~tauren-male-elder ${questId}-accept-tauren-male-elder tauren-male-elder`,
    ]);
  });
});
