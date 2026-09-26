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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { upsertResolution } from "@/lib/npc/store";
import { corpus, lineIndex } from "@/lib/quests/catalogue";
import { isGap, matchingLines, NO_CONTEXT } from "@/lib/search";

import { lineIsInExplorer, resolveContribution } from "./accept";
import { gossipFileName, gossipHash, gossipLineId, questFileName, questLineId } from "./naming";
import { createContribution, setContributionNpcKind, type Contribution } from "./store";

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
  await db().query(
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
    await db().query(`delete from "quest_line_speaker" where "contributionId" = any($1::int[])`, [contributionIds]);
    await db().query(`delete from "quest_line" where "origin" = 'contributed' and "note" = any($1::text[])`, [
      contributionIds.map((id) => `contribution #${id}`),
    ]);
    await db().query(
      `delete from "activity" where "kind" like 'contribution.%' and "subject" = any($1::text[])`,
      [contributionIds.map(String)],
    );
    await db().query(`delete from "contribution" where "id" = any($1::int[])`, [contributionIds]);
    contributionIds = [];
  }
  await db().query(`delete from "npc_resolution" where "npcId" between $1 and $2`, [base, base + 100]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
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
  const { rows } = await db().query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
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

async function speaker(id: number, race: string, gender: string, flavor: string | null = null): Promise<void> {
  await upsertResolution({
    npcKind: "creature",
    npcId: id,
    npcName: "Test Speaker",
    race,
    gender,
    flavor,
    provenance: "moderator",
    confirmed: true,
    modelFileId: null,
    sex: null,
    creatureType: null,
    build: null,
    note: null,
    resolvedBy: RESOLVER,
  });
}

async function speakersOf(contributionId: number): Promise<{ lineId: string; ord: number }[]> {
  const { rows } = await db().query<{ lineId: string; ord: number }>(
    `select "lineId", "ord" from "quest_line_speaker" where "contributionId" = $1`,
    [contributionId],
  );
  return rows;
}

async function linesFor(lineId: string): Promise<{ origin: string; generatable: boolean; skipReason: string | null }[]> {
  const { rows } = await db().query(
    `select "origin", "generatable", "skipReason" from "quest_line" where "lineId" = $1 and "lang" = 'enUS'`,
    [lineId],
  );
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
    // A client guess can name any race the model table knows; voices.ts decides what is voiced.
    await speaker(npcId, "draenei", "female");
    const id = await questContribution();
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome).toMatchObject({ ok: false, reason: "needs-speaker" });
    expect((outcome as { message: string }).message).toMatch(/draenei-female isn't a voice yet/);
  });

  it("refuses a quests contribution whose NPC has no resolved speaker", async () => {
    const id = await questContribution();
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome).toMatchObject({ ok: false, reason: "needs-speaker" });

    const { rows } = await db().query(`select "status" from "contribution" where "id" = $1`, [id]);
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

  it("voices a progress line like any other", async () => {
    await speaker(npcId, "orc", "female", "standard");
    const id = await questContribution({ event: "progress" });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    expect(await linesFor(questLineId(questId, "progress"))).toEqual([
      { origin: "contributed", generatable: true, skipReason: null },
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

  it("refuses to move an accepted line back to new or rejected", async () => {
    await speaker(npcId, "orc", "female", "standard");

    const id = await questContribution();
    await resolveContribution(id, "accepted", RESOLVER);

    const outcome = await resolveContribution(id, "rejected", RESOLVER);
    expect(outcome).toMatchObject({ ok: false, reason: "one-way" });

    const { rows } = await db().query(`select "status" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].status).toBe("accepted");
  });

  it("the corpus wins on a collision: marks the contribution but writes nothing", async () => {
    await speaker(npcId, "human", "male", "standard");

    // quest 33 accept is a real, committed corpus line (corpus.test.ts pins the same one).
    const id = await questContribution({ quest: "33", event: "accept", title: "Wolves Across the Border" });
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    expect(outcome.ok).toBe(true);

    expect(await speakersOf(id)).toHaveLength(0);
    expect((await linesFor("q:33:accept")).map((l) => l.origin)).not.toContain("contributed");
    if (outcome.ok) expect(await lineIsInExplorer(outcome.contribution)).toBe(true);
  });

  it("the corpus wins when it only carries a quest moment's player-gender variants", async () => {
    await speaker(npcId, "human", "male", "standard");

    // The corpus has q:166:complete:m and :f and no bare q:166:complete.
    const id = await questContribution({ quest: "166", event: "complete", title: "The Defias Brotherhood" });
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    expect(await speakersOf(id)).toHaveLength(0);
    expect(await linesFor("q:166:complete")).toHaveLength(0);
  });

  it("a second contribution for the same quest moment accepts cleanly, without a second line", async () => {
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
    expect(await speakersOf(second)).toHaveLength(0);

    const { rows: statuses } = await db().query<{ status: string }>(
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
