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
import { BASE_LANG } from "@/lib/lang";
import { upsertResolution } from "@/lib/npc/store";
import { invalidateRoster } from "@/lib/voices/roster-store";
import { corpus, lineIndex } from "@/lib/quests/catalogue";
import { isGap, matchingLines, NO_CONTEXT } from "@/lib/search";

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
  setContributionPage,
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
    const notes = contributionIds.map((id) => `contribution #${id}`);
    await db().query(`delete from "book_line" where "origin" = 'contributed' and "note" = any($1::text[])`, [notes]);
    await db().query(`delete from "entity_name" where "note" = any($1::text[])`, [notes]);
    await db().query(
      `delete from "activity" where "kind" like 'contribution.%' and "subject" = any($1::text[])`,
      [contributionIds.map(String)],
    );
    await db().query(`delete from "contribution" where "id" = any($1::int[])`, [contributionIds]);
    contributionIds = [];
  }
  await db().query(`delete from "npc" where "npcId" between $1 and $2`, [base, base + 100]);
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

  it("a greeting from a generic type the narrator reads is filed under the narrator's hash", async () => {
    await speaker(npcId, "creature", null);
    const text = "The ground hums beneath your feet, stranger.";
    const id = await gossipContribution(text, npcId);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await db().query(
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
    await db().query(`insert into "race" ("key") values ($1)`, [type]);
    await db().query(`insert into "voice" ("name", "race", "gender") values ($1, $1, '')`, [type]);
    await db().query(`insert into "voice_assignment" ("race", "voice") values ($1, $1)`, [type]);
    invalidateRoster();
    try {
      await speaker(npcId, type, null);
      const text = "Creak. The old wood remembers you.";
      const id = await gossipContribution(text, npcId);
      expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);
      const { rows } = await db().query(
        `select "lineId", "race", "gender", "voice" from "quest_line_speaker" where "contributionId" = $1`,
        [id],
      );
      expect(rows).toEqual([{ lineId: gossipLineId(gossipHash(text, type, "")), race: type, gender: "", voice: type }]);
    } finally {
      await db().query(`delete from "quest_line_speaker" where "npcId" = $1`, [npcId]);
      await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
      await db().query(`delete from "voice_assignment" where "race" = $1`, [type]);
      await db().query(`delete from "voice" where "name" = $1`, [type]);
      await db().query(`delete from "race" where "key" = $1`, [type]);
      invalidateRoster();
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
  it("two contributions for one quest moment write one line and are both accepted", async () => {
    await speaker(npcId, "orc", "female", "standard");
    await speaker(npcId + 1, "orc", "female", "standard");
    const first = await questContribution({}, npcId, "Bring me six wolf pelts, druid.");
    const second = await questContribution({}, npcId + 1, "Bring me six wolf pelts, mage.");

    const outcomes = await resolveContributions([first, second], "accepted", RESOLVER);
    expect([first, second].map((id) => (outcomes.get(id) as { ok: boolean }).ok)).toEqual([true, true]);

    expect(await linesFor(questLineId(questId, "accept"))).toHaveLength(1);
    const written = [...(await speakersOf(first)), ...(await speakersOf(second))];
    expect(written).toHaveLength(1);
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
    await db().query(
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
    const { rows } = await db().query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(rows[0].id);
    return rows[0].id;
  }

  it("writes a line with two English variants once, as variant 0", async () => {
    // q:4265:complete is one English text under two content patches' titles.
    const { rows: english } = await db().query<{ variant: number }>(
      `select "variant" from "quest_line" where "lineId" = 'q:4265:complete' and "lang" = $1 and "isCurrent"`,
      [BASE_LANG],
    );
    if (english.length < 2) return;
    const { rows: existing } = await db().query(
      `select 1 from "quest_line" where "lineId" = 'q:4265:complete' and "lang" = $1`,
      [LOCALE],
    );
    if (existing.length) return;

    const id = await translation("4265", "complete", "Bem-vindo de volta, $N.");
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await db().query<{ variant: number }>(
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
    const { rows } = await db().query(
      `select "name", "origin" from "entity_name"
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
      [kind, String(entityId), LOCALE],
    );
    return rows;
  }

  it("says which moments already have a speaker, in any language, which accept takes with no answer", async () => {
    const id = await translation(String(questId), "accept", "Traga-me seis peles de lobo, $C.");
    const rows = async () => (await listContributions("new", LOCALE)).filter((row) => row.id === id);
    expect(await momentHasSpeaker(await rows())).toEqual(new Set());
    await englishLine();
    expect(await momentHasSpeaker(await rows())).toEqual(new Set([id]));
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
      const { rows } = await db().query(
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
      const { rows: speakers } = await db().query(
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
      await db().query(
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
      await db().query(`delete from "quest_line_speaker" where "lineId" like $1`, [`q:${questId}:%`]);
      await db().query(`delete from "quest_line" where "lineId" like $1`, [`q:${questId}:%`]);
    });

    /** English's line for the moment as the extract writes a `$G` one: `:m` and `:f`, one speaker each. */
    async function englishByPlayerGender(): Promise<void> {
      await speaker(npcId, "tauren", "male", "warrior");
      for (const [index, g] of (["m", "f"] as const).entries()) {
        await db().query(
          `insert into "quest_line"
             ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
              "questTitle", "playerGender", "fileName", "text", "originalText", "generatable")
           values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'A Test Quest', $3, $4, $5, $6, true)`,
          [`${momentId()}:${g}`, questId, g, `${g}-${questFileName(questId, "accept")}`,
           g === "m" ? "Well met, lad." : "Well met, lass.", "Well met, $glad:lass;."],
        );
        await db().query(
          `insert into "quest_line_speaker"
             ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
           values ($1, 0, 'enUS', $2, 'creature', $3, 'Test Speaker', 'tauren', 'male', 'warrior', 'tauren-male-warrior')`,
          [`${momentId()}:${g}`, 1_950_000_000 + (questId % 20_000_000) * 2 + index, npcId],
        );
      }
    }

    async function lines(lang: string) {
      const { rows } = await db().query(
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
    await db().query(`delete from "gossip_broadcast" where "broadcastTextId" between $1 and $2`, [bt, bt + 10]);
    await db().query(`delete from "broadcast_text" where "broadcastTextId" between $1 and $2`, [bt, bt + 10]);
    await db().query(
      `delete from "entity_name" where "kind" = 'creature' and "entityId" = any($1::text[])`,
      [[String(npcId), String(npcId + 1)]],
    );
  });

  async function broadcast(lang: string, id: number, text: string, text1 = ""): Promise<void> {
    await db().query(
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
    const { rows } = await db().query<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(rows[0].id);
    return rows[0].id;
  }

  async function accepted(id: number): Promise<Contribution> {
    const outcome = await resolveContribution(id, "accepted", RESOLVER);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome));
    return outcome.contribution;
  }

  async function rows(lineId: string) {
    const { rows } = await db().query<{ lang: string; text: string; fileName: string }>(
      `select "lang", "text", "fileName" from "quest_line" where "lineId" = $1 and "isCurrent" order by "lang"`,
      [lineId],
    );
    return rows;
  }

  async function idsOf(lineId: string): Promise<number[]> {
    const { rows } = await db().query<{ id: number }>(
      `select "broadcastTextId" as "id" from "gossip_broadcast" where "lineId" = $1 order by 1`,
      [lineId],
    );
    return rows.map((row) => row.id);
  }

  async function linesSpeaking(id: number): Promise<string[]> {
    const { rows } = await db().query<{ lineId: string }>(
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
        await db().query(
          `insert into "quest_line"
             ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "playerGender",
              "fileName", "text", "originalText", "generatable")
           values ($1, 0, 'enUS', 1, true, 'extracted', 'gossip', $2, $3, $4, $5, true)`,
          [`g:${stem}:${g}`, g, `${g}-${stem}`, g === "m" ? "Well met, lad." : "Well met, lass.", "Well met, $glad:lass;."],
        );
        await db().query(
          `insert into "quest_line_speaker"
             ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
           values ($1, 0, 'enUS', $2, 'creature', $3, 'Test Speaker', 'tauren', 'male', 'warrior', $4)`,
          [`g:${stem}:${g}`, 1_960_000_000 + (bt % 10_000_000) * 2 + index, npcId, VOICE],
        );
        await db().query(
          `insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy") values ($1, $2, 'text')`,
          [`g:${stem}:${g}`, bt],
        );
      }
      await broadcast(LOCALE, bt, PORTUGUESE);

      await accepted(await greeting(LOCALE, PORTUGUESE));
      const { rows: written } = await db().query(
        `select "lineId", "playerGender", "fileName", "originalText" from "quest_line"
          where "lineId" like $1 and "lang" = $2 and "isCurrent"`,
        [`g:${stem}%`, LOCALE],
      );
      expect(written).toEqual([
        { lineId: `g:${stem}`, playerGender: null, fileName: stem, originalText: "Well met, $glad:lass;." },
      ]);
    } finally {
      await db().query(`delete from "quest_line_speaker" where "lineId" like $1 and "lang" = 'enUS'`, [`g:${stem}:%`]);
      await db().query(`delete from "quest_line" where "lineId" like $1 and "origin" = 'extracted'`, [`g:${stem}:%`]);
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
});

describe("resolveContribution: a book page in another language", () => {
  // A language no import on this machine writes, so the rows here are this test's own.
  const LOCALE = "ptBR";

  /** A books contribution as the addon files one: keyed on the checksum, naming no page. */
  async function page(text: string, book: string): Promise<number> {
    const dedup = `accept-test-${Math.random().toString(36).slice(2)}`;
    // Not a real checksum, so no real contribution shares it.
    await createContribution({
      source: "books",
      key: dedup,
      locale: LOCALE,
      build: "1.15.7/61582",
      text,
      meta: { page: dedup, book, number: "1" },
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

  async function row(id: number): Promise<Contribution> {
    const { rows } = await db().query<Contribution>(
      `select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`,
      [id],
    );
    return rows[0];
  }

  /**
   * An English page of this test's own, so it needs no imported corpus: ids far outside
   * vmangos's, and an owner no language has named.
   */
  let seeded: number[] = [];

  afterEach(async () => {
    await db().query(`delete from "book_line" where "pageId" = any($1::int[])`, [seeded]);
    // The English name book_line's trigger gave each owner (0036).
    await db().query(`delete from "entity_name" where "kind" = 'gameobject' and "entityId" = any($1::text[])`, [
      seeded.map(String),
    ]);
    seeded = [];
  });

  async function untranslatedPage(): Promise<{ pageId: number; lineId: string; owner: string; kind: string }> {
    const pageId = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    seeded.push(pageId);
    await db().query(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
          "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "text")
       values ($1, $2, 1, true, 'extracted', $3, $3, 1, 1, 'A Test Tome', 'object', $4, 'Words.')`,
      [`b:${pageId}`, BASE_LANG, pageId, [pageId]],
    );
    return { pageId, lineId: `b:${pageId}`, owner: String(pageId), kind: "gameobject" };
  }

  it("refuses a row nobody has matched to a page, and writes nothing", async () => {
    const id = await page("Uma página sem par.", "Livro Nenhum");
    expect(await resolveContribution(id, "accepted", RESOLVER)).toMatchObject({ ok: false, reason: "needs-page" });
    expect((await row(id)).status).toBe("new");
  });

  it("writes the matched page in its language, with the title the client showed", async () => {
    const target = await untranslatedPage();
    const id = await page("Olá, $N. Esta é a página.", "Livro de Teste");
    expect(await setContributionPage(id, target.pageId, RESOLVER)).toMatchObject({ pageId: target.pageId });
    expect(await lineIsInExplorer({ ...(await row(id)), status: "accepted" })).toBe(false);
    expect((await resolveContribution(id, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await db().query(
      `select "origin", "version", "isCurrent", "text", "title", "editedBy", "generatable"
         from "book_line" where "lineId" = $1 and "lang" = $2`,
      [target.lineId, LOCALE],
    );
    expect(rows).toEqual([
      {
        origin: "contributed",
        version: 1,
        isCurrent: true,
        text: "Olá, $N. Esta é a página.",
        title: "Livro de Teste",
        editedBy: RESOLVER,
        generatable: true,
      },
    ]);
    const { rows: names } = await db().query(
      `select "name", "origin" from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
      [target.kind, target.owner, LOCALE],
    );
    // Not 'edited': an import that finds the game's own name must be free to promote over it.
    expect(names).toEqual([{ name: "Livro de Teste", origin: "contributed" }]);
    expect(await lineIsInExplorer(await row(id))).toBe(true);
  });

  it("leaves a page this language already has alone, and is one-way once written", async () => {
    const target = await untranslatedPage();
    const first = await page("O primeiro texto.", "Livro de Teste");
    const second = await page("O segundo texto.", "Outro Título");
    await setContributionPage(first, target.pageId, RESOLVER);
    await setContributionPage(second, target.pageId, RESOLVER);
    expect((await resolveContribution(first, "accepted", RESOLVER)).ok).toBe(true);
    expect((await resolveContribution(second, "accepted", RESOLVER)).ok).toBe(true);

    const { rows } = await db().query(`select "text" from "book_line" where "lineId" = $1 and "lang" = $2`, [
      target.lineId, LOCALE,
    ]);
    expect(rows).toEqual([{ text: "O primeiro texto." }]);
    expect(await resolveContribution(first, "rejected", RESOLVER)).toMatchObject({ ok: false, reason: "one-way" });
    // The match under a written page cannot move either.
    expect(await setContributionPage(first, null, RESOLVER)).toBeNull();
    expect((await row(first)).pageId).toBe(target.pageId);
  });
});
