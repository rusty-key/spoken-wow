/**
 * Accepting a quests contribution, against a real Postgres and the quest tables.
 *
 * Needs DATABASE_URL, migrations applied (0034 in particular -- this is the file that exercises
 * it) and the quest corpus imported. Every contribution, npc_resolution, quest_line and
 * quest_line_speaker row here is created and torn down by the test itself; the rows already in
 * those tables (the extract, and whatever was filed from the game) are never written to -- see
 * this file's own care around npcId/questId, which are randomised well outside any id the
 * corpus or an addon submission could plausibly produce.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogue } from "@/lib/readables/catalogue";
import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { BASE_LANG } from "@/lib/lang";
import { upsertResolution } from "@/lib/npc/store";
import { corpus, lineIndex } from "@/lib/quests/catalogue";
import { isGap, matchingLines, NO_CONTEXT } from "@/lib/search";

import { acceptCorrection } from "./correction";
import { lineIsInExplorer, momentHasSpeaker, resolveContribution, resolveContributions } from "./accept";
import {
  broadcastGossipStem,
  gossipFileName,
  gossipHash,
  gossipLineId,
  localizedGossipStem,
  questFileName,
  questLineId,
} from "./naming";
import {
  createContribution,
  CONTRIBUTION_COLUMNS,
  listContributions,
  setContributionNpcKind,
  setContributionMatch,
  type Contribution,
} from "./store";

const RESOLVER = "test-contributions-accept";

// Far outside anything the 1.12 world database or a real addon submission could produce, so
// there is no risk of this test ever touching a row the game actually filed.
const base = 950_000_000 + Math.floor(Math.random() * 40_000_000);
const npcId = base;
const questId = base + 1;

// A real, committed corpus gossip line (npcId 68, Stormwind City Guard) whose originalText
// carries a trailing space that normaliseText strips at intake.
const GUARD_LINE = "g:7df84a254c23565acaa7fc468ead3ab2";
const GUARD_TEXT =
  "Lookin' to take a gryphon ride, eh? Dungar keeps his birds up on the rampart in the Trade District. Just remember to hold on tight!";

let contributionIds: number[] = [];

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Accept Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  if (contributionIds.length) {
    // The speaker rows reference the contribution (no action on delete), so they go first,
    // then the lines this run wrote, then the contributions themselves.
    await asSystem.query(`delete from "quest_line_speaker" where "contributionId" = any($1::int[])`, [contributionIds]);
    await asSystem.query(`delete from "quest_line" where "origin" = 'contributed' and "note" = any($1::text[])`, [
      contributionIds.map((id) => `contribution #${id}`),
    ]);
    const notes = contributionIds.map((id) => `contribution #${id}`);
    await asSystem.query(`delete from "line_ignore" where "reason" = any($1::text[])`, [
      notes.map((note) => `Rejected ${note}`),
    ]);
    await asSystem.query(`delete from "activity" where "kind" = 'ignore.set' and "actorId" = $1`, [RESOLVER]);
    await asSystem.query(`delete from "book_line" where "origin" = 'contributed' and "note" = any($1::text[])`, [notes]);
    await asSystem.query(`delete from "entity_name" where "note" = any($1::text[])`, [notes]);
    await asSystem.query(
      `delete from "activity" where "kind" like 'contribution.%' and "subject" = any($1::text[])`,
      [contributionIds.map(String)],
    );
    await asSystem.query(`delete from "contribution" where "id" = any($1::int[])`, [contributionIds]);
    contributionIds = [];
  }
  await asSystem.query(`delete from "npc" where "npcId" between $1 and $2`, [base, base + 100]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

async function contribution(key: string, text: string, meta: Record<string, string>): Promise<number> {
  const dedup = `accept-test-${Math.random().toString(36).slice(2)}`;
  await createContribution({
    source: "quests",
    key,
    locale: "enUS",
    build: "1.12.1/5875",
    text,
    meta,
    raw: `raw:${dedup}`,
    dedup,
    body: null,
    name: null,
    email: null,
    userId: null,
    ip: null,
  });
  const { rows } = await asSystem.query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
  contributionIds.push(rows[0].id);
  return rows[0].id;
}

function questContribution(
  overrides: Partial<Contribution["meta"]> = {},
  speakerId: number = npcId,
  text = "Bring me six wolf pelts, druid.",
): Promise<number> {
  const meta = { quest: String(questId), event: "accept", title: "A Test Quest", kind: "creature", npc: `${speakerId} Test Speaker`, ...overrides };
  return contribution(`${meta.quest}:${meta.event}`, text, meta);
}

function gossipContribution(text: string, speakerId: number): Promise<number> {
  return contribution(`npc:${speakerId}`, text, { kind: "creature", npc: `${speakerId} Test Speaker` });
}

async function speaker(id: number, race: string, gender: string | null, flavor: string | null = null): Promise<void> {
  await upsertResolution({
    npcKind: "creature",
    npcId: id,
    npcName: "Test Speaker",
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
    resolvedBy: RESOLVER,
  });
}

async function speakersOf(contributionId: number): Promise<{ lineId: string; ord: number }[]> {
  const { rows } = await asSystem.query<{ lineId: string; ord: number }>(
    `select "lineId", "ord" from "quest_line_speaker" where "contributionId" = $1`,
    [contributionId],
  );
  return rows;
}

async function linesFor(lineId: string): Promise<{ origin: string; generatable: boolean; skipReason: string | null }[]> {
  const { rows } = await asSystem.query(
    `select "origin", "generatable", "skipReason" from "quest_line" where "lineId" = $1 and "lang" = 'enUS'`,
    [lineId],
  );
  return rows;
}

/** An English quest line as an import writes it, which fires the quest_line name trigger. */
const INSERT_ENGLISH_LINE = `insert into "quest_line"
    ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
     "questTitle", "fileName", "text", "originalText")
  values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'A Test Quest', $1, 'Test.', 'Test.')`;

/** The names the English triggers wrote for this run's quest and NPCs, which carry no note. */
async function deleteTriggerNames(): Promise<void> {
  await asSystem.query(
    `delete from "entity_name"
      where ("kind" = 'quest' and "entityId" = $1) or ("kind" = 'creature' and "entityId" = any($2::text[]))`,
    [String(questId), [0, 1, 2].map((offset) => String(npcId + offset))],
  );
}

async function ignoresOf(lineId: string): Promise<{ lang: string | null; reason: string }[]> {
  const { rows } = await asSystem.query(`select "lang", "reason" from "line_ignore" where "lineId" = $1`, [lineId]);
  return rows;
}

describe("resolveContribution: quests accept", () => {
  it("refuses a kind-less contribution whose id has conflicting answers, until one is chosen", async () => {
    await speaker(npcId, "orc", "female", "standard");
    await upsertResolution({
      npcKind: "gameobject",
      npcId,
      npcName: "Test Speaker",
      race: "human",
      gender: "male",
      flavor: null,
      provenance: "corpus",
      confirmed: true,
      doubtful: false,
      modelFileId: null,
      sex: null,
      creatureType: null,
      build: null,
      note: null,
      resolvedBy: RESOLVER,
    });
    const id = await questContribution({ kind: "" });

    const refused = await resolveContribution(id, "accepted", RESOLVER);
    expect(refused).toMatchObject({ ok: false, reason: "needs-speaker" });
    expect((refused as { message: string }).message).toMatch(/conflicting/);

    expect(await setContributionNpcKind(id, "creature", RESOLVER)).toBe(true);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);
    const speakers = (await lineIndex()).get(questLineId(questId, "accept"))!;
    expect(speakers[0]).toMatchObject({ race: "orc", contributionId: id });
  });

  it("refuses a speaker whose voice is not on the roster", async () => {
    // A client guess can name any race the model table knows; the roster decides what is voiced.
    await speaker(npcId, "draenei", "female");
    const id = await questContribution();
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome).toMatchObject({ ok: false, reason: "needs-speaker" });
    expect((outcome as { message: string }).message).toMatch(/No voice reads draenei-female yet/);
  });

  it("refuses a quests contribution whose NPC has no resolved speaker", async () => {
    const id = await questContribution();
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome).toMatchObject({ ok: false, reason: "needs-speaker" });

    const { rows } = await asSystem.query(`select "status" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].status).toBe("new");
  });

  it("writes the line into the quest tables: in the explorer, missing audio, marked contributed", async () => {
    await speaker(npcId, "tauren", "male", "warrior");

    const id = await questContribution();
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contribution.status).toBe("accepted");

    const lineId = questLineId(questId, "accept");
    expect(await linesFor(lineId)).toEqual([{ origin: "contributed", generatable: true, skipReason: null }]);

    // The catalogue -- what the explorer, the regenerate flow and the export all read.
    const group = (await lineIndex()).get(lineId);
    expect(group).toHaveLength(1);
    expect(group![0]).toMatchObject({
      lineId,
      fileName: questFileName(questId, "accept"),
      source: "accept",
      questId,
      npcId,
      voice: "tauren-male-warrior",
      text: "Bring me six wolf pelts, druid.",
      contributionId: id,
    });

    // The missing-audio filter, against an empty store: nothing has been generated for it.
    const lines = await corpus();
    const line = lines.lines.find((l) => l.lineId === lineId)!;
    expect(isGap(line, new Set())).toBe(true);
    const missing = matchingLines(lines, new Set(), { state: "missing", line: lineId }, NO_CONTEXT);
    expect(missing.map((l) => l.lineId)).toEqual([lineId]);

    // Its speaker sits above the extract's own numbering, clear of any re-import.
    const [row] = await speakersOf(id);
    expect(row.ord).toBeGreaterThanOrEqual(1_000_000);
    expect(await lineIsInExplorer(outcome.contribution)).toBe(true);
  });

  it("keeps a progress line but never voices it, as the extract marks its own", async () => {
    await speaker(npcId, "orc", "female", "standard");
    const id = await questContribution({ event: "progress" });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    expect(await linesFor(questLineId(questId, "progress"))).toEqual([
      { origin: "contributed", generatable: false, skipReason: "progress" },
    ]);
  });

  it("does not duplicate on re-accept", async () => {
    await speaker(npcId, "orc", "female", "standard");

    const id = await questContribution();
    await resolveContribution(id, "accepted", RESOLVER);
    await resolveContribution(id, "accepted", RESOLVER);

    expect(await speakersOf(id)).toHaveLength(1);
    expect(await linesFor(questLineId(questId, "accept"))).toHaveLength(1);
  });

  it("refuses to move an accepted line back to new, or to rejected without the right to ignore", async () => {
    await speaker(npcId, "orc", "female", "standard");

    const id = await questContribution();
    await resolveContribution(id, "accepted", RESOLVER);

    expect(await resolveContribution(id, "new", RESOLVER, undefined, true)).toMatchObject({ ok: false, reason: "one-way" });
    expect(await resolveContribution(id, "rejected", RESOLVER)).toMatchObject({ ok: false, reason: "one-way" });

    const { rows } = await asSystem.query(`select "status" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].status).toBe("accepted");
    expect(await ignoresOf(questLineId(questId, "accept"))).toEqual([]);
  });

  it("rejects an accepted line by ignoring it, keeping what it wrote", async () => {
    await speaker(npcId, "orc", "female", "standard");

    const id = await questContribution();
    await resolveContribution(id, "accepted", RESOLVER);

    expect(await resolveContribution(id, "rejected", RESOLVER, undefined, true)).toMatchObject({ ok: true });
    const { rows } = await asSystem.query(`select "status" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].status).toBe("rejected");
    expect(await ignoresOf(questLineId(questId, "accept"))).toEqual([
      { lang: null, reason: `Rejected contribution #${id}` },
    ]);
    expect(await speakersOf(id)).toHaveLength(1);
    expect(await linesFor(questLineId(questId, "accept"))).toHaveLength(1);
  });

  it("the corpus wins on a collision: writes no line, only its NPC as one more speaker", async () => {
    await speaker(npcId, "human", "male", "standard");

    // quest 33 accept is a real, committed corpus line (corpus.test.ts pins the same one).
    const id = await questContribution({ quest: "33", event: "accept", title: "Wolves Across the Border" });
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome.ok).toBe(true);

    expect(await speakersOf(id)).toEqual([{ lineId: "q:33:accept", ord: expect.any(Number) }]);
    expect((await linesFor("q:33:accept")).map((l) => l.origin)).not.toContain("contributed");
    if (outcome.ok) expect(await lineIsInExplorer(outcome.contribution)).toBe(true);
  });

  it("the corpus wins on a collision with its own speaker: writes nothing", async () => {
    const { rows } = await asSystem.query<{ npcType: string; npcId: number }>(
      `select "npcType", "npcId" from "quest_line_speaker" where "lineId" = 'q:33:accept' and "lang" = 'enUS' limit 1`,
    );
    const id = await questContribution(
      { quest: "33", event: "accept", title: "Wolves Across the Border", kind: rows[0].npcType },
      rows[0].npcId,
    );
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);
    expect(await speakersOf(id)).toHaveLength(0);
  });

  it("the corpus wins when it only carries a quest moment's player-gender variants", async () => {
    await speaker(npcId, "human", "male", "standard");

    // The corpus has q:166:complete:m and :f and no bare q:166:complete.
    const id = await questContribution({ quest: "166", event: "complete", title: "The Defias Brotherhood" });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    // Its NPC speaks both sides, as the dump's speakers do.
    expect((await speakersOf(id)).map((row) => row.lineId).sort()).toEqual(["q:166:complete:f", "q:166:complete:m"]);
    expect(await linesFor("q:166:complete")).toHaveLength(0);
  });

  it("a second contribution for the same quest moment adds its NPC as a speaker, without a second line", async () => {
    // dedup is on (source, key, locale, text) -- a druid and a mage accepting the same quest
    // moment are two different contributions for one q:X:event.
    const secondNpcId = npcId + 1;
    await speaker(npcId, "orc", "female", "standard");
    await speaker(secondNpcId, "orc", "female", "standard");

    const first = await questContribution({}, npcId, "Bring me six wolf pelts, druid.");
    const second = await questContribution({}, secondNpcId, "Bring me six wolf pelts, mage.");

    expect((await resolveContribution(first, "accepted", RESOLVER)).ok).toBe(true);
    expect((await resolveContribution(second, "accepted", RESOLVER)).ok).toBe(true);

    expect(await linesFor(questLineId(questId, "accept"))).toHaveLength(1);
    expect(await speakersOf(second)).toEqual([{ lineId: questLineId(questId, "accept"), ord: expect.any(Number) }]);

    const { rows: statuses } = await asSystem.query<{ status: string }>(
      `select "status" from "contribution" where "id" = any($1::int[]) order by "id"`,
      [[first, second]],
    );
    expect(statuses.map((r) => r.status)).toEqual(["accepted", "accepted"]);
  });

  it("a new gossip line is written under its hash, as the extract names its own", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    const text = "The winds carry word of you, stranger. Walk with the Earth Mother.";
    const id = await gossipContribution(text, npcId);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const hash = gossipHash(text, "tauren", "male");
    const group = (await lineIndex()).get(gossipLineId(hash));
    expect(group).toHaveLength(1);
    expect(group![0]).toMatchObject({ source: "gossip", fileName: gossipFileName(hash), questId: null, contributionId: id });
  });

  it("a greeting from a generic type the narrator reads is filed under the narrator's hash", async () => {
    await speaker(npcId, "creature", null);
    const text = "The ground hums beneath your feet, stranger.";
    const id = await gossipContribution(text, npcId);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await asSystem.query(
      `select "lineId", "race", "gender", "voice" from "quest_line_speaker" where "contributionId" = $1`,
      [id],
    );
    expect(rows).toEqual([
      { lineId: gossipLineId(gossipHash(text, "narrator", "male")), race: "narrator", gender: "male", voice: "narrator-male" },
    ]);
  });

  it("a second NPC of a generic type joins the narrator's line rather than minting another", async () => {
    const text = "Something stirs in the roots, stranger.";
    await speaker(npcId, "creature", null);
    expect((await resolveContribution(await gossipContribution(text, npcId), "accepted", RESOLVER)).ok).toBe(true);
    await speaker(npcId + 1, "creature", null);
    const second = await gossipContribution(text, npcId + 1);
    expect((await resolveContribution(second, "accepted", RESOLVER)).ok).toBe(true);

    expect((await speakersOf(second)).map((s) => s.lineId)).toEqual([gossipLineId(gossipHash(text, "narrator", "male"))]);
  });

  it("a greeting from a genderless type an admin added is voiced by its own voice", async () => {
    const type = `t${npcId}`;
    await asSystem.query(`insert into "race" ("key") values ($1)`, [type]);
    await asSystem.query(`insert into "voice" ("name", "race", "gender", "teamId") values ($1, $1, '', team_of_lang('enUS'))`, [type]);
    await asSystem.query(`insert into "voice_assignment" ("race", "voice", "teamId") values ($1, $1, team_of_lang('enUS'))`, [type]);
    try {
      await speaker(npcId, type, null);
      const text = "Creak. The old wood remembers you.";
      const id = await gossipContribution(text, npcId);
      expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);
      const { rows } = await asSystem.query(
        `select "lineId", "race", "gender", "voice" from "quest_line_speaker" where "contributionId" = $1`,
        [id],
      );
      expect(rows).toEqual([{ lineId: gossipLineId(gossipHash(text, type, "")), race: type, gender: "", voice: type }]);
    } finally {
      await asSystem.query(`delete from "quest_line_speaker" where "npcId" = $1`, [npcId]);
      await asSystem.query(`delete from "npc" where "npcId" = $1`, [npcId]);
      await asSystem.query(`delete from "voice_assignment" where "race" = $1`, [type]);
      await asSystem.query(`delete from "voice" where "name" = $1`, [type]);
      await asSystem.query(`delete from "race" where "key" = $1`, [type]);
    }
  });

  it("a gossip line whose only speaker moved to another voice gains a speaker on the line, not the voice", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    const text = "The plains remember every hoofbeat, stranger.";
    const first = await gossipContribution(text, npcId);
    expect((await resolveContribution(first, "accepted", RESOLVER)).ok).toBe(true);
    // Its only speaker now speaks it in another voice's line, so the catalogue lists no plain row.
    await speaker(npcId, "tauren", "male", "elder");

    await speaker(npcId + 1, "tauren", "male", "warrior");
    const second = await gossipContribution(text, npcId + 1);
    expect((await resolveContribution(second, "accepted", RESOLVER)).ok).toBe(true);

    const lineId = gossipLineId(gossipHash(text, "tauren", "male"));
    expect((await speakersOf(second)).map((s) => s.lineId)).toEqual([lineId]);
  });

  it("a line sent with the reader's tokens keeps them as its template and speaks them as the extract does", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    const template = "Well met, $N. The $R $c walks with the Earth Mother.";
    const id = await gossipContribution(template, npcId);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    // Hashed on the template, as the extract hashes the world database's own.
    const lineId = gossipLineId(gossipHash(template, "tauren", "male"));
    const group = (await lineIndex()).get(lineId);
    expect(group).toHaveLength(1);
    expect(group![0]).toMatchObject({
      text: "Well met, Adventurer. The Traveler adventurer walks with the Earth Mother.",
      originalText: template,
    });
  });

  it("a gossip line the corpus already has gains this NPC as one more speaker, not a copy", async () => {
    // A verbatim duplicate of GUARD_LINE up to the trailing space the corpus carries, spoken by
    // an NPC the corpus does not have saying it.
    await speaker(npcId, "human", "male", "official");
    const id = await gossipContribution(GUARD_TEXT, npcId);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    expect((await speakersOf(id)).map((s) => s.lineId)).toEqual([GUARD_LINE]);
    expect((await linesFor(GUARD_LINE)).map((l) => l.origin)).not.toContain("contributed");
    const speakers = (await lineIndex()).get(GUARD_LINE)!;
    expect(speakers.some((l) => l.npcId === npcId && l.contributionId === id)).toBe(true);
  });
});

describe("resolveContributions: a batch, side by side", () => {
  it("two contributions for one quest moment write one line, with both NPCs as its speakers", async () => {
    await speaker(npcId, "orc", "female", "standard");
    await speaker(npcId + 1, "orc", "female", "standard");
    const first = await questContribution({}, npcId, "Bring me six wolf pelts, druid.");
    const second = await questContribution({}, npcId + 1, "Bring me six wolf pelts, mage.");

    const outcomes = await resolveContributions([first, second], "accepted", RESOLVER);
    expect([first, second].map((id) => (outcomes.get(id) as { ok: boolean }).ok)).toEqual([true, true]);

    expect(await linesFor(questLineId(questId, "accept"))).toHaveLength(1);
    const written = [...(await speakersOf(first)), ...(await speakersOf(second))];
    expect(written).toHaveLength(2);
  });

  it("a quest moment from the same NPC twice is spoken by it once", async () => {
    await speaker(npcId, "orc", "female", "standard");
    const first = await questContribution({}, npcId, "Bring me six wolf pelts, druid.");
    const second = await questContribution({}, npcId, "Bring me six wolf pelts, mage.");

    await resolveContributions([first, second], "accepted", RESOLVER);
    expect([...(await speakersOf(first)), ...(await speakersOf(second))]).toHaveLength(1);
  });

  it("one new gossip line sent by two NPCs is written once, with both as its speakers", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await speaker(npcId + 1, "tauren", "male", "warrior");
    const text = "The winds carry word of you, stranger. Walk with the Earth Mother.";
    const first = await gossipContribution(text, npcId);
    const second = await gossipContribution(text, npcId + 1);

    const outcomes = await resolveContributions([first, second], "accepted", RESOLVER);
    expect([first, second].map((id) => (outcomes.get(id) as { ok: boolean }).ok)).toEqual([true, true]);

    const lineId = gossipLineId(gossipHash(text, "tauren", "male"));
    expect(await linesFor(lineId)).toHaveLength(1);
    expect((await speakersOf(first)).map((s) => s.lineId)).toEqual([lineId]);
    expect((await speakersOf(second)).map((s) => s.lineId)).toEqual([lineId]);
  });

  it("two rows of one new quest both land, though each names the quest in English", async () => {
    await speaker(npcId, "orc", "female", "standard");
    const accept = await questContribution({}, npcId);
    const complete = await questContribution({ event: "complete" }, npcId, "Well done, druid.");

    try {
      const outcomes = await resolveContributions([accept, complete], "accepted", RESOLVER);
      expect(outcomes.get(accept)).toMatchObject({ ok: true });
      expect(outcomes.get(complete)).toMatchObject({ ok: true });
    } finally {
      await deleteTriggerNames();
    }
  });

  // What the batch above can only hit by timing: the second transaction's trigger reaches
  // entity_name_set while the first has written the quest's name but not committed it.
  it("a second writer of a quest's first English name waits for the first, rather than failing", async () => {
    const first = await db().connect();
    const second = await db().connect();
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query(INSERT_ENGLISH_LINE, [questLineId(questId, "accept"), questId]);
      const blocked = second.query(INSERT_ENGLISH_LINE, [questLineId(questId, "complete"), questId]);
      // Long enough for the second insert to reach the trigger and block on the first.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.query("commit");
      await blocked;
      await second.query("commit");

      const { rows } = await asSystem.query(
        `select "version", "isCurrent" from "entity_name"
          where "kind" = 'quest' and "entityId" = $1 and "lang" = 'enUS'`,
        [String(questId)],
      );
      expect(rows).toEqual([{ version: 1, isCurrent: true }]);
    } finally {
      await first.query("rollback").catch(() => {});
      await second.query("rollback").catch(() => {});
      first.release();
      second.release();
      await asSystem.query(`delete from "quest_line" where "questId" = $1 and "origin" = 'extracted'`, [questId]);
      await deleteTriggerNames();
    }
  });

  it("a refused row keeps its refusal and the rest still land", async () => {
    await speaker(npcId, "orc", "female", "standard");
    const good = await questContribution({}, npcId);
    const unresolved = await questContribution({ event: "complete" }, npcId + 2);

    const outcomes = await resolveContributions([good, unresolved], "accepted", RESOLVER);
    expect(outcomes.get(good)).toMatchObject({ ok: true });
    expect(outcomes.get(unresolved)).toMatchObject({ ok: false, reason: "needs-speaker" });
  });
});

describe("resolveContribution: a translation", () => {
  // A language no import on this machine writes, so the rows here are this test's own.
  const LOCALE = "ptBR";

  afterEach(async () => {
    // The English names quest_line's and quest_line_speaker's triggers gave this test's own
    // quest and NPC (0036), and the ones accepting wrote in LOCALE.
    await asSystem.query(
      `delete from "entity_name" where "kind" in ('quest', 'creature') and "entityId" = any($1::text[])`,
      [[String(questId), String(npcId)]],
    );
  });

  async function translation(
    quest: string,
    event: string,
    text: string,
    meta: Record<string, string> = { title: "Liberado de la colmena", kind: "creature", npc: "7880 Ginro" },
  ): Promise<number> {
    const dedup = `accept-test-${Math.random().toString(36).slice(2)}`;
    await createContribution({
      source: "quests",
      key: `${quest}:${event}`,
      locale: LOCALE,
      build: "1.12.1/5875",
      text,
      meta: { quest, event, ...meta },
      raw: `raw:${dedup}`,
      dedup,
      body: null,
      name: null,
      email: null,
      userId: null,
      ip: null,
    });
    const { rows } = await asSystem.query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(rows[0].id);
    return rows[0].id;
  }

  it("writes a line with two English variants once, as variant 0", async () => {
    // q:4265:complete is one English text under two content patches' titles.
    const { rows: english } = await asSystem.query<{ variant: number }>(
      `select "variant" from "quest_line" where "lineId" = 'q:4265:complete' and "lang" = $1 and "isCurrent"`,
      [BASE_LANG],
    );
    if (english.length < 2) return;
    const { rows: existing } = await asSystem.query(
      `select 1 from "quest_line" where "lineId" = 'q:4265:complete' and "lang" = $1`,
      [LOCALE],
    );
    if (existing.length) return;

    const id = await translation("4265", "complete", "Bem-vindo de volta, $N.");
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await asSystem.query<{ variant: number }>(
      `select "variant" from "quest_line" where "lineId" = 'q:4265:complete' and "lang" = $1`,
      [LOCALE],
    );
    expect(rows.map((row) => row.variant)).toEqual([0]);
  });

  /** This test's own English line for questId's accept, spoken by npcId, as an English accept writes it. */
  async function englishLine(): Promise<void> {
    await speaker(npcId, "tauren", "male", "warrior");
    expect((await resolveContribution(await questContribution(), "accepted", RESOLVER)).ok).toBe(true);
  }

  async function nameIn(kind: string, entityId: number): Promise<{ name: string; origin: string }[]> {
    const { rows } = await asSystem.query(
      `select "name", "origin" from "entity_name"
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
      [kind, String(entityId), LOCALE],
    );
    return rows;
  }

  it("says which moments already have the row's speaker, in any language, which accept takes with no answer", async () => {
    const same = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $C.", {
      title: "Uma Missão de Teste",
      kind: "creature",
      npc: `${npcId} Orador`,
    });
    // Ginro is not who English has speaking it: accepting makes him one more speaker, so he needs an answer.
    const other = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $N.");
    const rows = async () => (await listContributions("new", LOCALE)).filter((row) => row.id === same || row.id === other);
    expect(await momentHasSpeaker(await rows())).toEqual(new Set());
    await englishLine();
    expect(await momentHasSpeaker(await rows())).toEqual(new Set([same]));
  });

  it("names the quest and the NPC in the language, as the client showed them", async () => {
    await englishLine();
    const id = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $C.", {
      title: "Uma Missão de Teste",
      kind: "creature",
      npc: `${npcId} Orador de Teste`,
    });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    // Not 'edited': an import that finds the game's own name must be free to promote over it.
    expect(await nameIn("quest", questId)).toEqual([{ name: "Uma Missão de Teste", origin: "contributed" }]);
    expect(await nameIn("creature", npcId)).toEqual([{ name: "Orador de Teste", origin: "contributed" }]);
  });

  it("leaves a name the language already has alone", async () => {
    await englishLine();
    const first = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $C.", {
      title: "O Primeiro Título",
      kind: "creature",
      npc: `${npcId} O Primeiro Nome`,
    });
    const second = await translation(String(questId), "accept", "Outro texto.", {
      title: "O Segundo Título",
      kind: "creature",
      npc: `${npcId} O Segundo Nome`,
    });
    expect((await resolveContribution(first, "accepted", RESOLVER)).ok).toBe(true);
    expect((await resolveContribution(second, "accepted", RESOLVER)).ok).toBe(true);

    expect(await nameIn("quest", questId)).toEqual([{ name: "O Primeiro Título", origin: "contributed" }]);
    expect(await nameIn("creature", npcId)).toEqual([{ name: "O Primeiro Nome", origin: "contributed" }]);
  });

  it("does not name an NPC whose envelope never said what kind of thing it is", async () => {
    await englishLine();
    const id = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $C.", {
      title: "Uma Missão de Teste",
      npc: `${npcId} Orador de Teste`,
    });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    expect(await nameIn("quest", questId)).toHaveLength(1);
    expect(await nameIn("creature", npcId)).toEqual([]);
  });

  describe("of a line English does not have", { timeout: 20_000 }, () => {
    const momentId = () => questLineId(questId, "accept");
    const PORTUGUESE = "Traga-me seis peles de lobo, $C.";

    function native(text = PORTUGUESE): Promise<number> {
      return translation(String(questId), "accept", text, {
        title: "Uma Missão de Teste",
        kind: "creature",
        npc: `${npcId} Orador de Teste`,
      });
    }

    async function rowsIn(lang: string) {
      const { rows } = await asSystem.query(
        `select "lineId", "variant", "origin", "fileName", "text", "originalText", "localeText",
                "generatable", "skipReason"
           from "quest_line" where "lineId" = $1 and "lang" = $2`,
        [momentId(), lang],
      );
      return rows;
    }

    async function accepted(id: number): Promise<Contribution> {
      const outcome = await resolveContribution(id, "accepted", RESOLVER);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("refused");
      return outcome.contribution;
    }

    it("writes it as the language's own line, with who speaks it", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      const contribution = await accepted(await native());

      expect(await rowsIn(LOCALE)).toEqual([
        {
          lineId: momentId(),
          variant: 0,
          origin: "contributed",
          fileName: questFileName(questId, "accept"),
          text: PORTUGUESE,
          originalText: PORTUGUESE,
          localeText: PORTUGUESE,
          generatable: true,
          skipReason: null,
        },
      ]);
      expect(await rowsIn(BASE_LANG)).toEqual([]);
      const { rows: speakers } = await asSystem.query(
        `select "lineId", "lang", "voice" from "quest_line_speaker" where "contributionId" = $1`,
        [contribution.id],
      );
      expect(speakers).toEqual([{ lineId: momentId(), lang: LOCALE, voice: "tauren-male-warrior" }]);
      expect(await lineIsInExplorer(contribution)).toBe(true);
    });

    it("lists it in the language and not in English", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      await accepted(await native());

      const listed = (await corpus(LOCALE)).lines.filter((line) => line.lineId === momentId());
      expect(listed).toEqual([
        expect.objectContaining({
          text: PORTUGUESE,
          questTitle: "Uma Missão de Teste",
          npcName: "Orador de Teste",
          voice: "tauren-male-warrior",
          generatable: true,
        }),
      ]);
      expect(listed[0].english).toBeUndefined();
      expect(listed[0].missing).toBeUndefined();
      expect((await corpus(BASE_LANG)).lines.some((line) => line.lineId === momentId())).toBe(false);
    });

    it("refuses one whose speaker nobody has answered, and writes nothing", async () => {
      const outcome = await resolveContribution(await native(), "accepted", RESOLVER);
      expect(outcome).toMatchObject({ ok: false, reason: "needs-speaker" });
      expect(await rowsIn(LOCALE)).toEqual([]);
    });

    it("takes a second contribution of the moment as the same line", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      await accepted(await native());
      const second = await accepted(await native("Outro texto."));

      expect((await rowsIn(LOCALE)).map((row) => row.text)).toEqual([PORTUGUESE]);
      expect(await speakersOf(second.id)).toEqual([]);
      expect(await lineIsInExplorer(second)).toBe(true);
    });

    it("becomes the translation of the English line once English sends it", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      await accepted(await native());
      await englishLine();

      const listed = (await corpus(LOCALE)).lines.filter((line) => line.lineId === momentId());
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        text: PORTUGUESE,
        originalText: "Bring me six wolf pelts, druid.",
        english: { questTitle: "A Test Quest" },
      });
      expect(listed[0].missing?.text).toBeFalsy();
    });

    it("takes the speaker the language wrote when English sends the moment, writing none of its own", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      await accepted(await native());
      const english = await accepted(await questContribution());

      expect(await speakersOf(english.id)).toEqual([]);
      const listed = (await corpus(BASE_LANG)).lines.filter((line) => line.lineId === momentId());
      expect(listed).toEqual([expect.objectContaining({ npcId, voice: "tauren-male-warrior" })]);
      expect(await lineIsInExplorer(english)).toBe(true);
    });

    it("names the language's speaker in English, where English has a name for the NPC", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      await accepted(await native());
      await asSystem.query(
        `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
         values ('creature', $1, 'enUS', 1, true, 'extracted', 'Test Speaker')
         on conflict do nothing`,
        [String(npcId)],
      );
      await accepted(await questContribution());

      const listed = (await corpus(BASE_LANG)).lines.filter((line) => line.lineId === momentId());
      expect(listed.map((line) => line.npcName)).toEqual(["Test Speaker"]);
    });

    it("is one-way once its text is written, even with no speaker row of its own", async () => {
      await englishLine();
      const translated = await accepted(await native());
      expect(await speakersOf(translated.id)).toEqual([]);

      expect(await resolveContribution(translated.id, "new", RESOLVER)).toMatchObject({ ok: false, reason: "one-way" });
    });

    it("translates English that landed after the catalogue was read", async () => {
      await speaker(npcId, "tauren", "male", "warrior");
      const before = (await corpus()).lines;
      await englishLine();
      const id = await native();

      const outcome = await resolveContribution(id, "accepted", RESOLVER, before);
      expect(outcome.ok).toBe(true);
      expect(await speakersOf(id)).toEqual([]);
      expect((await rowsIn(LOCALE)).map((row) => row.originalText)).toEqual(["Bring me six wolf pelts, druid."]);
    });
  });

  describe("whose text decides its own lines", { timeout: 20_000 }, () => {
    const momentId = () => questLineId(questId, "accept");

    afterEach(async () => {
      await asSystem.query(`delete from "quest_line_speaker" where "lineId" like $1`, [`q:${questId}:%`]);
      await asSystem.query(`delete from "quest_line" where "lineId" like $1`, [`q:${questId}:%`]);
    });

    /** English's line for the moment as the extract writes a `$G` one: `:m` and `:f`, one speaker each. */
    async function englishByPlayerGender(): Promise<void> {
      await speaker(npcId, "tauren", "male", "warrior");
      for (const [index, g] of (["m", "f"] as const).entries()) {
        await asSystem.query(
          `insert into "quest_line"
             ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
              "questTitle", "playerGender", "fileName", "text", "originalText", "generatable")
           values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'A Test Quest', $3, $4, $5, $6, true)`,
          [`${momentId()}:${g}`, questId, g, `${g}-${questFileName(questId, "accept")}`,
           g === "m" ? "Well met, lad." : "Well met, lass.", "Well met, $glad:lass;."],
        );
        await asSystem.query(
          `insert into "quest_line_speaker"
             ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
           values ($1, 0, 'enUS', $2, 'creature', $3, 'Test Speaker', 'tauren', 'male', 'warrior', 'tauren-male-warrior')`,
          [`${momentId()}:${g}`, 1_950_000_000 + (questId % 20_000_000) * 2 + index, npcId],
        );
      }
    }

    async function lines(lang: string) {
      const { rows } = await asSystem.query(
        `select "lineId", "playerGender", "fileName", "originalText" from "quest_line"
          where "lineId" like $1 and "lang" = $2 and "isCurrent" order by "lineId"`,
        [`q:${questId}:%`, lang],
      );
      return rows;
    }

    it("writes one line where English has two, translating the male one", async () => {
      await englishByPlayerGender();
      const id = await translation(String(questId), "accept", "Saudações.", { kind: "creature", npc: `${npcId} Orador` });
      expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

      expect(await lines(LOCALE)).toEqual([
        { lineId: momentId(), playerGender: null, fileName: questFileName(questId, "accept"), originalText: "Well met, $glad:lass;." },
      ]);
      const listed = (await corpus(LOCALE)).lines.filter((line) => line.lineId.startsWith(momentId()));
      expect(listed.map((line) => [line.lineId, line.npcId, line.text])).toEqual([[momentId(), npcId, "Saudações."]]);
    });

    it("writes two lines where its own text branches on the player's gender, though English has one", async () => {
      await englishLine();
      const id = await translation(String(questId), "accept", "Saudações, $gsenhor:senhora;.", { kind: "creature", npc: `${npcId} Orador` });
      expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

      const file = questFileName(questId, "accept");
      expect(await lines(LOCALE)).toEqual([
        { lineId: `${momentId()}:f`, playerGender: "f", fileName: `f-${file}`, originalText: "Bring me six wolf pelts, druid." },
        { lineId: `${momentId()}:m`, playerGender: "m", fileName: `m-${file}`, originalText: "Bring me six wolf pelts, druid." },
      ]);
      const listed = (await corpus(LOCALE)).lines.filter((line) => line.lineId.startsWith(momentId()));
      expect(listed.map((line) => [line.lineId, line.npcId, line.english?.questTitle])).toEqual([
        [`${momentId()}:f`, npcId, "A Test Quest"],
        [`${momentId()}:m`, npcId, "A Test Quest"],
      ]);
    });

    it("lists English's two lines, untranslated, for a language with neither", async () => {
      await englishByPlayerGender();
      const listed = (await corpus(LOCALE)).lines.filter((line) => line.lineId.startsWith(momentId()));
      expect(listed.map((line) => [line.lineId, line.missing?.text])).toEqual([
        [`${momentId()}:f`, true],
        [`${momentId()}:m`, true],
      ]);
    });
  });
});

describe("resolveContribution: a greeting in any language", { timeout: 20_000 }, () => {
  // A language no import on this machine writes, so the rows here are this test's own.
  const LOCALE = "ptBR";
  // BroadcastText ids of this run's own, far above the game's.
  const bt = base;
  const VOICE = "tauren-male-warrior";
  const ENGLISH = "Welcome to the test lodge, $n.";
  const PORTUGUESE = "Bem-vindo ao alojamento de teste, $n.";

  afterEach(async () => {
    await asSystem.query(`delete from "gossip_broadcast" where "broadcastTextId" between $1 and $2`, [bt, bt + 10]);
    await asSystem.query(`delete from "broadcast_text" where "broadcastTextId" between $1 and $2`, [bt, bt + 10]);
    await asSystem.query(
      `delete from "entity_name" where "kind" = 'creature' and "entityId" = any($1::text[])`,
      [[String(npcId), String(npcId + 1)]],
    );
  });

  async function broadcast(lang: string, id: number, text: string, text1 = ""): Promise<void> {
    await asSystem.query(
      `insert into "broadcast_text" ("lang", "broadcastTextId", "text", "text1", "build") values ($1, $2, $3, $4, 1)`,
      [lang, id, text, text1],
    );
  }

  async function greeting(lang: string, text: string, speakerId = npcId): Promise<number> {
    const dedup = `accept-test-${Math.random().toString(36).slice(2)}`;
    await createContribution({
      source: "quests",
      key: `npc:${speakerId}`,
      locale: lang,
      build: "1.12.1/5875",
      text,
      meta: { kind: "creature", npc: `${speakerId} Test Speaker` },
      raw: `raw:${dedup}`,
      dedup,
      body: null,
      name: null,
      email: null,
      userId: null,
      ip: null,
    });
    const { rows } = await asSystem.query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(rows[0].id);
    return rows[0].id;
  }

  async function accepted(id: number): Promise<Contribution> {
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome));
    return outcome.contribution;
  }

  async function rows(lineId: string) {
    const { rows } = await asSystem.query<{ lang: string; text: string; fileName: string }>(
      `select "lang", "text", "fileName" from "quest_line" where "lineId" = $1 and "isCurrent" order by "lang"`,
      [lineId],
    );
    return rows;
  }

  async function idsOf(lineId: string): Promise<number[]> {
    const { rows } = await asSystem.query<{ id: number }>(
      `select "broadcastTextId" as "id" from "gossip_broadcast" where "lineId" = $1 order by 1`,
      [lineId],
    );
    return rows.map((row) => row.id);
  }

  async function linesSpeaking(id: number): Promise<string[]> {
    const { rows } = await asSystem.query<{ lineId: string }>(
      `select "lineId" from "gossip_broadcast" where "broadcastTextId" = $1 order by 1`,
      [id],
    );
    return rows.map((row) => row.lineId);
  }

  it("mints a line by its BroadcastText id in the language, then English lands on the same line", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await broadcast(LOCALE, bt, PORTUGUESE);
    await broadcast(BASE_LANG, bt, ENGLISH);
    const lineId = gossipLineId(broadcastGossipStem(bt, VOICE));

    await accepted(await greeting(LOCALE, PORTUGUESE));
    expect(await rows(lineId)).toEqual([{ lang: LOCALE, text: PORTUGUESE, fileName: broadcastGossipStem(bt, VOICE) }]);
    expect(await idsOf(lineId)).toEqual([bt]);

    await accepted(await greeting(BASE_LANG, "Welcome to the test lodge, $N."));
    expect((await rows(lineId)).map((row) => row.lang)).toEqual([BASE_LANG, LOCALE]);
    expect(await linesSpeaking(bt)).toEqual([lineId]);
  });

  it("translates an English line found by its id, rather than minting another", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await broadcast(BASE_LANG, bt, ENGLISH);
    await broadcast(LOCALE, bt, PORTUGUESE);
    const english = await accepted(await greeting(BASE_LANG, ENGLISH));
    const [{ lineId }] = await speakersOf(english.id);
    expect(lineId).toBe(gossipLineId(broadcastGossipStem(bt, VOICE)));

    const portuguese = await accepted(await greeting(LOCALE, PORTUGUESE));
    expect((await rows(lineId)).map((row) => [row.lang, row.text])).toEqual([
      [BASE_LANG, "Welcome to the test lodge, adventurer."],
      [LOCALE, PORTUGUESE],
    ]);
    expect(await speakersOf(portuguese.id)).toEqual([]);
    expect(await linesSpeaking(bt)).toEqual([lineId]);
    expect(await lineIsInExplorer(portuguese)).toBe(true);
  });

  it("translates English's two player-gender lines as one, its own text having no $g", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    const stem = broadcastGossipStem(bt, VOICE);
    try {
      for (const [index, g] of (["m", "f"] as const).entries()) {
        await asSystem.query(
          `insert into "quest_line"
             ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "playerGender",
              "fileName", "text", "originalText", "generatable")
           values ($1, 0, 'enUS', 1, true, 'extracted', 'gossip', $2, $3, $4, $5, true)`,
          [`g:${stem}:${g}`, g, `${g}-${stem}`, g === "m" ? "Well met, lad." : "Well met, lass.", "Well met, $glad:lass;."],
        );
        await asSystem.query(
          `insert into "quest_line_speaker"
             ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
           values ($1, 0, 'enUS', $2, 'creature', $3, 'Test Speaker', 'tauren', 'male', 'warrior', $4)`,
          [`g:${stem}:${g}`, 1_960_000_000 + (bt % 10_000_000) * 2 + index, npcId, VOICE],
        );
        await asSystem.query(
          `insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy") values ($1, $2, 'text')`,
          [`g:${stem}:${g}`, bt],
        );
      }
      await broadcast(LOCALE, bt, PORTUGUESE);

      await accepted(await greeting(LOCALE, PORTUGUESE));
      const { rows: written } = await asSystem.query(
        `select "lineId", "playerGender", "fileName", "originalText" from "quest_line"
          where "lineId" like $1 and "lang" = $2 and "isCurrent"`,
        [`g:${stem}%`, LOCALE],
      );
      expect(written).toEqual([
        { lineId: `g:${stem}`, playerGender: null, fileName: stem, originalText: "Well met, $glad:lass;." },
      ]);
    } finally {
      await asSystem.query(`delete from "quest_line_speaker" where "lineId" like $1 and "lang" = 'enUS'`, [`g:${stem}:%`]);
      await asSystem.query(`delete from "quest_line" where "lineId" like $1 and "origin" = 'extracted'`, [`g:${stem}:%`]);
    }
  });

  it("adds an NPC of the same voice as one more speaker of the moment", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await speaker(npcId + 1, "tauren", "male", "warrior");
    await broadcast(LOCALE, bt, PORTUGUESE);
    await accepted(await greeting(LOCALE, PORTUGUESE));
    const second = await accepted(await greeting(LOCALE, PORTUGUESE, npcId + 1));
    expect(await speakersOf(second.id)).toEqual([
      expect.objectContaining({ lineId: gossipLineId(broadcastGossipStem(bt, VOICE)) }),
    ]);
  });

  it("names a line with no English and no id after its own language", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    const stem = localizedGossipStem(LOCALE, gossipHash(PORTUGUESE, "tauren", "male"));
    const contribution = await accepted(await greeting(LOCALE, PORTUGUESE));
    expect(await rows(gossipLineId(stem))).toEqual([{ lang: LOCALE, text: PORTUGUESE, fileName: stem }]);
    expect(await idsOf(gossipLineId(stem))).toEqual([]);

    // Found again by its words: the same line, nothing written twice.
    const again = await accepted(await greeting(LOCALE, `  ${PORTUGUESE.toUpperCase()} `));
    expect(await speakersOf(again.id)).toEqual([]);
    expect(await lineIsInExplorer(contribution)).toBe(true);
    expect(await lineIsInExplorer(again)).toBe(true);
  });

  it("re-accepting changes nothing", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await broadcast(LOCALE, bt, PORTUGUESE);
    const id = await greeting(LOCALE, PORTUGUESE);
    await accepted(id);
    await accepted(id);
    expect(await rows(gossipLineId(broadcastGossipStem(bt, VOICE)))).toHaveLength(1);
    expect(await speakersOf(id)).toHaveLength(1);
  });

  it("takes the lowest of several ids with the same words, in the speaker's form", async () => {
    await speaker(npcId, "tauren", "female", "shaman");
    await broadcast(LOCALE, bt + 2, "Olá, $gamigo:amiga;.", "Olá, $gamigo:amiga;.");
    await broadcast(LOCALE, bt + 1, "Bom dia, senhor.", "Olá, amiga.");
    await accepted(await greeting(LOCALE, "Olá, amiga."));
    expect(await linesSpeaking(bt + 1)).toEqual([gossipLineId(broadcastGossipStem(bt + 1, "tauren-female-shaman"))]);
    expect(await linesSpeaking(bt + 2)).toEqual([]);
  });

  it("matches a $g branch as either side", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await broadcast(LOCALE, bt, "Bem-vindo, $gamigo:amiga;.");
    await accepted(await greeting(LOCALE, "Bem-vindo, amiga."));
    expect(await linesSpeaking(bt)).toEqual([gossipLineId(broadcastGossipStem(bt, VOICE))]);
  });

  it("matches a $u branch the client left unresolved", async () => {
    await speaker(npcId, "tauren", "male", "warrior");
    await broadcast(LOCALE, bt, "Bem-vindo, $uamigo:amiga;.");
    await accepted(await greeting(LOCALE, "Bem-vindo, $uamigo:amiga;."));
    expect(await linesSpeaking(bt)).toEqual([gossipLineId(broadcastGossipStem(bt, VOICE))]);
  });
});


describe("resolveContribution: a readables contribution, in any language", () => {
  /**
   * A two-page book of this test's own, in English and esMX, owned by an object no language has
   * named, and two more books sharing one English title. Ids far outside vmangos's, fresh per
   * test, so no run reads another's pages.
   */
  let base: number;
  let seeded: string[] = [];
  let DUSTY: string;

  async function seedPage(
    lineId: string,
    bookId: string,
    pageNumber: number,
    owner: number | null,
    texts: [lang: string, title: string, text: string][],
  ): Promise<void> {
    seeded.push(lineId);
    await asSystem.query(
      `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds")
       values ($1, $2, $3, $4, $5, $6)`,
      [lineId, Number(lineId.slice(2)), bookId, pageNumber, owner === null ? null : "object", owner === null ? null : [owner]],
    );
    for (const [lang, title, text] of texts) await textRow(lineId, lang, text, title);
  }

  async function textRow(lineId: string, lang: string, text: string, title = "Libro"): Promise<void> {
    await asSystem.query(
      `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
       values ($1, $2, 1, true, 'extracted', $3, $4)`,
      [lineId, lang, title, text],
    );
  }

  beforeEach(async () => {
    base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    DUSTY = `Dusty ${base}`;
    const owner = base;
    await seedPage(`b:${base}`, String(base), 1, owner, [
      ["enUS", `A Test Tome ${base}`, `Words one ${base}.`],
      ["esMX", `Libro ${base}`, `Palabras esMX uno ${base}.`],
    ]);
    await seedPage(`b:${base + 1}`, String(base), 2, owner, [
      ["enUS", `A Test Tome ${base}`, `Words two ${base}.`],
      ["esMX", `Libro ${base}`, `Palabras esMX dos ${base}.`],
    ]);
    await seedPage(`b:${base + 10}`, String(base + 10), 1, null, [["enUS", DUSTY, `Dust one ${base}.`]]);
    await seedPage(`b:${base + 20}`, String(base + 20), 1, null, [["enUS", DUSTY, `Dust two ${base}.`]]);
  });

  afterEach(async () => {
    const notes = contributionIds.map((id) => `contribution #${id}`);
    await asSystem.query(
      `delete from "book_page" where "lineId" like 'b:n%'
          and "lineId" in (select "lineId" from "book_line" where "note" = any($1::text[]))`,
      [notes],
    );
    // A correction is 'edited', which the file's own cleanup leaves.
    await asSystem.query(`delete from "book_line" where "note" = any($1::text[])`, [notes]);
    await asSystem.query(`delete from "book_line" where "lineId" = any($1::text[])`, [seeded]);
    await asSystem.query(`delete from "book_page" where "lineId" = any($1::text[])`, [seeded]);
    // The English name book_line's trigger gives the seeded owner.
    await asSystem.query(`delete from "entity_name" where "kind" = 'gameobject' and "entityId" = $1`, [String(base)]);
    seeded = [];
  });

  /** A readables contribution as the addon files one: keyed on the checksum, naming no page. */
  async function readablesRow(over: { locale: string; text: string; meta: Record<string, string> }): Promise<number> {
    const dedup = `accept-test-${Math.random().toString(36).slice(2)}`;
    await createContribution({
      source: "readables",
      key: dedup,
      locale: over.locale,
      build: "1.15.7/61582",
      text: over.text,
      meta: { page: dedup, ...over.meta },
      raw: `raw:${dedup}`,
      dedup,
      body: null,
      name: null,
      email: null,
      userId: null,
      ip: null,
    });
    const { rows } = await asSystem.query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(rows[0].id);
    return rows[0].id;
  }

  async function row(id: number): Promise<Contribution> {
    const { rows } = await asSystem.query<Contribution>(`select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`, [id]);
    return rows[0];
  }

  async function textOf(lineId: string, lang: string) {
    const { rows } = await asSystem.query(
      `select "text", "origin", "title" from "book_line" where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [lineId, lang],
    );
    return rows[0];
  }

  async function versionsOf(lineId: string, lang: string) {
    const { rows } = await asSystem.query(
      `select "version", "isCurrent", "text" from "book_line" where "lineId" = $1 and "lang" = $2 order by "version" desc`,
      [lineId, lang],
    );
    return rows;
  }

  async function pagesTitled(title: string, lang: string) {
    const { rows } = await asSystem.query<{ lineId: string; bookId: string; pageNumber: number }>(
      `select p."lineId", p."bookId", p."pageNumber" from "book_page" p
         join "book_line" l on l."lineId" = p."lineId" and l."lang" = $2 and l."isCurrent"
        where l."title" = $1 order by p."pageNumber"`,
      [title, lang],
    );
    return rows;
  }

  /** Until two backends wait on a lock at accept's readables lock or its book_page insert. */
  async function bothWaiting(): Promise<void> {
    for (let tries = 0; tries < 200; tries++) {
      // From pg_locks rather than pg_stat_activity, whose other sessions' queries the app role
      // may not read.
      const { rows } = await asSystem.query<{ n: number }>(
        `select count(*)::int as "n" from pg_locks
          where not "granted" and "database" = (select "oid" from pg_database where "datname" = current_database())
            and ("locktype" = 'advisory' or "relation" = '"book_page"'::regclass)`,
      );
      if (rows[0].n >= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the two accepts never both reached the lock");
  }

  async function ownersOf(lineId: string) {
    const { rows } = await asSystem.query(`select "ownerKind", "ownerIds" from "book_page" where "lineId" = $1`, [lineId]);
    return rows[0];
  }

  it("writes a translation of a page found by another language's words, naming its owner", async () => {
    const id = await readablesRow({ locale: "esES", text: `Palabras esMX uno ${base}.`, meta: { book: "Libro", number: "1" } });
    expect(await lineIsInExplorer({ ...(await row(id)), status: "accepted" })).toBe(false);
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await textOf(`b:${base}`, "esES")).toEqual({ text: `Palabras esMX uno ${base}.`, origin: "contributed", title: "Libro" });
    const { rows: names } = await asSystem.query(
      `select "name", "origin" from "entity_name" where "kind" = 'gameobject' and "entityId" = $1 and "lang" = 'esES' and "isCurrent"`,
      [String(base)],
    );
    // Not 'edited': an import that finds the game's own name must be free to promote over it.
    expect(names).toEqual([{ name: "Libro", origin: "contributed" }]);
    expect(await lineIsInExplorer(await row(id))).toBe(true);
  });

  it("writes a correction as a new version", async () => {
    await textRow(`b:${base}`, "esES", "Viejo texto.");
    const id = await readablesRow({ locale: "esES", text: `Palabras esMX uno ${base}.`, meta: { book: "Libro", number: "1" } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await versionsOf(`b:${base}`, "esES")).toEqual([
      { version: 2, isCurrent: true, text: `Palabras esMX uno ${base}.` },
      { version: 1, isCurrent: false, text: "Viejo texto." },
    ]);
    expect(await lineIsInExplorer(await row(id))).toBe(true);
    // A correction is written too, so it is as one-way as a first version.
    expect(await resolveContribution(id, "rejected", RESOLVER)).toMatchObject({ ok: false, reason: "one-way" });
  });

  it("counts an accepted readables correction as in the explorer", async () => {
    await textRow(`b:${base}`, "esES", "Viejo texto.");
    const id = await readablesRow({ locale: "esES", text: `Words one ${base}.`, meta: { book: "Libro", number: "1" } });
    expect(await acceptCorrection(id, RESOLVER)).toMatchObject({ ok: true });
    expect(await lineIsInExplorer(await row(id))).toBe(true);
  });

  it("writes the page a moderator named, and is one-way once written", async () => {
    const id = await readablesRow({ locale: "ptBR", text: "Olá, $N. Esta é a página.", meta: { book: "Livro de Teste", number: "1" } });
    await setContributionMatch(id, { lineId: `b:${base + 1}` }, RESOLVER);
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await textOf(`b:${base + 1}`, "ptBR")).toEqual({
      text: "Olá, $N. Esta é a página.", origin: "contributed", title: "Livro de Teste",
    });
    expect(await resolveContribution(id, "rejected", RESOLVER)).toMatchObject({ ok: false, reason: "one-way" });
    // The match under a written page cannot move either.
    expect(await setContributionMatch(id, null, RESOLVER)).toBeNull();
    expect((await row(id)).matchLineId).toBe(`b:${base + 1}`);
  });

  it("mints a new book, and its next page joins it", async () => {
    const title = `Instrucciones ${base}`;
    const first = await readablesRow({ locale: "esES", text: `Uno ${base}.`, meta: { book: title, number: "1" } });
    const third = await readablesRow({ locale: "esES", text: `Tres ${base}.`, meta: { book: title, number: "3" } });
    expect(await resolveContribution(first, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await resolveContribution(third, "accepted", RESOLVER)).toMatchObject({ ok: true });
    const pages = await pagesTitled(title, "esES");
    expect(pages).toHaveLength(2);
    expect(new Set(pages.map((p) => p.bookId)).size).toBe(1);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 3]);
    expect(pages[0].lineId).toMatch(/^b:n[0-9a-f-]{36}$/);
    expect(pages[0].bookId).toMatch(/^n[0-9a-f-]{36}$/);
    const { rows } = await asSystem.query(
      `select "pageId", "bookId", "pageNumber", "pageCount", "ownerKind", "ownerIds" from "book_line"
        where "lineId" = $1 and "lang" = 'esES'`,
      [pages[0].lineId],
    );
    expect(rows).toEqual([{ pageId: null, bookId: null, pageNumber: 1, pageCount: 1, ownerKind: null, ownerIds: null }]);
  });

  it("mints one book for two pages of one title accepted at once", async () => {
    const title = `Simultáneo ${base}`;
    const a = await readablesRow({ locale: "esES", text: `A ${base}.`, meta: { book: title, number: "1" } });
    const b = await readablesRow({ locale: "esES", text: `B ${base}.`, meta: { book: ` ${title} `, number: "2" } });
    // Each resolve takes its own pool connection. Holding book_page's inserts until both are
    // waiting -- one at the insert, the other at accept's lock, or both at the insert if
    // nothing serialised them -- makes the two transactions overlap every run.
    const blocker = await db().connect();
    let outcomes;
    try {
      await blocker.query("begin");
      await blocker.query(`lock table "book_page" in share mode`);
      const resolving = Promise.all([resolveContribution(a, "accepted", RESOLVER), resolveContribution(b, "accepted", RESOLVER)]);
      await bothWaiting();
      await blocker.query("commit");
      outcomes = await resolving;
    } finally {
      blocker.release();
    }
    expect(outcomes).toMatchObject([{ ok: true }, { ok: true }]);
    const pages = await pagesTitled(title, "esES");
    expect(pages).toHaveLength(2);
    expect(new Set(pages.map((p) => p.bookId)).size).toBe(1);
  });

  it("keeps a page's own title when an English correction names no book", async () => {
    const id = await readablesRow({ locale: "enUS", text: `New words one ${base}.`, meta: { number: "1", object: String(base) } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await textOf(`b:${base}`, "enUS")).toEqual({
      text: `New words one ${base}.`, origin: "edited", title: `A Test Tome ${base}`,
    });
  });

  it("counts a row accepted before readables rows were written as in the explorer where it would be", async () => {
    const english = await readablesRow({ locale: "enUS", text: `Old flow ${base}.`, meta: { book: DUSTY, number: "1" } });
    const translated = await readablesRow({ locale: "esMX", text: `Viejo ${base}.`, meta: { book: "Libro", number: "1" } });
    const lacking = await readablesRow({ locale: "deDE", text: `Alt ${base}.`, meta: { book: "Buch", number: "1" } });
    await asSystem.query(
      `update "contribution" set "status" = 'accepted', "matchLineId" = $2 where "id" = any($1::int[])`,
      [[english, translated, lacking], `b:${base}`],
    );
    expect(await lineIsInExplorer(await row(english))).toBe(true);
    expect(await lineIsInExplorer(await row(translated))).toBe(true);
    expect(await lineIsInExplorer(await row(lacking))).toBe(false);
  });

  it("refuses a row whose match changed since the moderator saw it", async () => {
    const id = await readablesRow({ locale: "esES", text: `Palabras esMX uno ${base}.`, meta: { book: "Libro", number: "1" } });
    const seen = { kind: "translation", lineId: `b:${base}`, via: "text" } as const;
    await textRow(`b:${base}`, "esES", "Otro texto.");
    expect(await resolveContribution(id, "accepted", RESOLVER, undefined, false, seen)).toMatchObject({
      ok: false, reason: "changed",
    });
    expect(await versionsOf(`b:${base}`, "esES")).toHaveLength(1);
  });

  it("accepts an English page the corpus lacks", async () => {
    const title = `New in Forever ${base}`;
    const id = await readablesRow({ locale: "enUS", text: `Forever only ${base}.`, meta: { book: title, number: "1" } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await pagesTitled(title, "enUS")).toHaveLength(1);
  });

  it("refuses an ambiguous row until a moderator answers, and writes nothing", async () => {
    const id = await readablesRow({ locale: "enUS", text: `Unseen ${base}.`, meta: { book: DUSTY, number: "1" } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: false, reason: "needs-page" });
    expect((await row(id)).status).toBe("new");
    expect(await pagesTitled(DUSTY, "enUS")).toHaveLength(2);
  });

  it("refuses a row whose words the page already has", async () => {
    const id = await readablesRow({ locale: "esMX", text: `Palabras esMX dos ${base}.`, meta: { book: `Libro ${base}`, number: "2" } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: false, reason: "malformed" });
    expect(await versionsOf(`b:${base + 1}`, "esMX")).toHaveLength(1);
  });

  it("adds the object the client read it from to the page's owners, once", async () => {
    const renumbered = String(base + 5);
    const first = await readablesRow({
      locale: "esES", text: `Palabras esMX uno ${base}.`, meta: { book: "Libro", number: "1", object: renumbered },
    });
    expect(await resolveContribution(first, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await ownersOf(`b:${base}`)).toEqual({ ownerKind: "object", ownerIds: [base, base + 5] });

    // Found by that object now, as a correction of the same page.
    const second = await readablesRow({
      locale: "esES", text: `Otras palabras ${base}.`, meta: { book: "Libro", number: "1", object: renumbered },
    });
    expect(await resolveContribution(second, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await versionsOf(`b:${base}`, "esES")).toHaveLength(2);
    expect(await ownersOf(`b:${base}`)).toEqual({ ownerKind: "object", ownerIds: [base, base + 5] });
  });

  it("gives a minted page the item it was read from, named so the page keeps its title", async () => {
    const item = base + 6;
    const id = await readablesRow({ locale: "esES", text: `Nueva ${base}.`, meta: { book: `Nuevo ${base}`, number: "1", item: String(item) } });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    const [page] = await pagesTitled(`Nuevo ${base}`, "esES");
    expect(await ownersOf(page.lineId)).toEqual({ ownerKind: "item", ownerIds: [item] });
    const listed = (await catalogue("esES")).find((p) => p.id === page.lineId);
    expect(listed?.title).toBe(`Nuevo ${base}`);
    expect(listed?.missing).toBeUndefined();
  });

  it("keeps every language's title when a correction gives an ownerless page its first owner", async () => {
    await seedPage(`b:${base + 30}`, String(base + 30), 1, null, [
      ["deDE", `Staubiges Buch ${base}`, `Staub ${base}.`],
      ["esES", `Libro polvoriento ${base}`, `Polvo ${base}.`],
    ]);
    const id = await readablesRow({
      locale: "esES", text: `Polvo corregido ${base}.`,
      meta: { book: `Libro polvoriento ${base}`, number: "1", object: String(base + 31) },
    });
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await ownersOf(`b:${base + 30}`)).toEqual({ ownerKind: "object", ownerIds: [base + 31] });
    const german = (await catalogue("deDE")).find((p) => p.id === `b:${base + 30}`);
    expect(german?.title).toBe(`Staubiges Buch ${base}`);
    expect(german?.missing).toBeUndefined();
    const spanish = (await catalogue("esES")).find((p) => p.id === `b:${base + 30}`);
    expect(spanish?.title).toBe(`Libro polvoriento ${base}`);
  });

  it("leaves an id the corpus already knows on its own page", async () => {
    const id = await readablesRow({
      locale: "esES", text: `Polvo uno ${base}.`, meta: { book: DUSTY, number: "1", object: String(base) },
    });
    await setContributionMatch(id, { lineId: `b:${base + 10}` }, RESOLVER);
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: true });
    expect(await ownersOf(`b:${base + 10}`)).toEqual({ ownerKind: null, ownerIds: null });
  });
});
