/**
 * The override layer, written as a token's owner acts: a second team's member writes its own
 * team's rows and never the original, and a text maintainer still writes the original.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileIndex } from "@/lib/audio";
import { saveStory } from "@/lib/bosses/story";
import { closeDb } from "@/lib/db";
import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { saveLore } from "@/lib/places/lore";
import { saveQuestText } from "@/lib/quests/text";
import { saveBookText } from "@/lib/readables/text";
import type { Source } from "@/lib/sections";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { applyItems } from "./apply";
import { backedScopes, type Layer, type TokenContext } from "./guard";
import { sections } from "./index";
import { createFixtures, type Fixtures } from "./testing";

let f: Fixtures;
let lang: Lang;
let a: TeamId;
let b: TeamId;
let u: { id: string; cleanup: () => Promise<void> };
let m: { id: string; cleanup: () => Promise<void> };
let ctxU: TokenContext;
let ctxM: TokenContext;
let welcome: string;
let elsewhere: string;
const npcIds: number[] = [];

const RACE = "testrace";

/**
 * A quest line of `lang` alone, spoken by one NPC of RACE and `gender` and written in
 * RACE-male's voice. A race no roster reads voices the NPC as RACE-gender, so a female speaker's
 * line is listed only as that voice's line, under another id and file.
 */
async function questLine(gender: "male" | "female", text: string, ord: number): Promise<string> {
  const questId = 900_000_000 + Math.floor(Math.random() * 100_000_000);
  const npcId = -questId;
  npcIds.push(npcId);
  const lineId = `q:${questId}:accept`;
  await asSystem.query(
    `insert into "npc" ("npcKind", "npcId", "race", "gender", "provenance", "confirmed")
     values ('creature', $1, $2, $3, 'moderator', true)`,
    [npcId, RACE, gender],
  );
  await asSystem.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "voice")
     values ($1, 0, $2, $3, 'creature', $4, 'Test Speaker', $5, $6, $7)`,
    [lineId, lang, ord, npcId, RACE, gender, `${RACE}-male`],
  );
  await asSystem.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "questTitle",
        "fileName", "text", "originalText")
     values ($1, 0, $2, 1, true, 'edited', 'accept', $3, 'Eine Probe', $4, $5, $5)`,
    [lineId, lang, questId, `${questId}-accept`, text],
  );
  return lineId;
}

async function contextOf(userId: string): Promise<TokenContext> {
  const { row } = await createToken({
    userId,
    lang,
    access: "write",
    generate: false,
    label: "agent",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const backed = backedScopes(await viewerOf({ user: { id: userId, role: null } }), lang, "write", false);
  return { tokenId: row.id, userId, role: null, lang, access: "write", generate: false, layers: backed.layers };
}

beforeAll(async () => {
  f = await createFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true, "layer-a");
  b = await newTeamIn(lang, false, "layer-b");
  u = await testUser("test-layer-u");
  m = await testUser("test-layer-m");
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, m.id, lang, "regenerate");
  await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [
    m.id,
    lang,
  ]);
  forgetTeams();

  await saveLore({ lang, lineId: f.zone, full: "Unser Land.", editedBy: m.id });
  await saveStory({ lang, lineId: f.boss.lineId, text: "Der Boss spricht.", editedBy: m.id });
  await saveBookText({ lang, lineId: f.page.lineId, text: "Eine Seite.", editedBy: m.id });
  await saveQuestText({ lang, lineId: f.quest.lineId, variant: f.quest.variant, text: "Sei gegrüßt.", editedBy: m.id });
  welcome = await questLine("male", "Sei willkommen.", 1);
  elsewhere = await questLine("female", "Seid gegrüßt.", 2);

  ctxU = await contextOf(u.id);
  ctxM = await contextOf(m.id);
  // A language's corpus is a pass over every English line, too slow to build inside a test on CI.
  await fileIndex(lang);
  await asActor(u.id, () => fileIndex(lang));
}, 30_000);

afterAll(async () => {
  for (const table of ["line_override", "quest_line", "lore_line", "boss_line", "book_line", "api_batch", "api_token"]) {
    await asSystem.query(`delete from "${table}" where "lang" = $1`, [lang]);
  }
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "quest_line_speaker" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "npc" where "npcKind" = 'creature' and "npcId" = any($1)`, [npcIds]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await m.cleanup();
  await dropLang(lang);
  forgetTeams();
  await f.remove();
  await closeDb();
});

function run(ctx: TokenContext, section: Source, items: unknown[], layer: Layer) {
  return asActor(ctx.userId, () => applyItems(section, ctx, items, null, layer));
}

async function first(ctx: TokenContext, section: Source, item: unknown, layer: Layer = "override") {
  return (await run(ctx, section, [item], layer)).results[0];
}

const overrideTeams = async (source: string, lineId: string) =>
  (
    await asSystem.query<{ teamId: string; text: string }>(
      `select "teamId", "text" from "text_override" where "lang" = $1 and "source" = $2 and "lineId" = $3`,
      [lang, source, lineId],
    )
  ).rows;

const loreFull = async () =>
  (
    await asSystem.query<{ full: string }>(
      `select "full" from "lore_line" where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [f.zone, lang],
    )
  ).rows[0]?.full;

describe("a second team's member", () => {
  it("writes a place's override into its own team and leaves the original", async () => {
    const result = await first(ctxU, "places", { id: f.zone, text: "Ours." });
    expect(result.text).toMatchObject({ status: "updated", layer: "override" });
    expect(await loreFull()).toBe("Unser Land.");
    expect(await overrideTeams("places", f.zone)).toEqual([{ teamId: b, text: "Ours." }]);
  });

  it("logs the override under the run's batch", async () => {
    const { batchId } = await run(ctxU, "readables", [{ id: f.page.lineId, text: "Unsere Seite." }], "override");
    const { rows } = await asSystem.query(
      `select "teamId", "detail" from "activity" where "kind" = 'override.set' and "detail"->>'apiBatchId' = $1`,
      [batchId],
    );
    expect(rows).toEqual([{ teamId: b, detail: expect.objectContaining({ apiTokenId: ctxU.tokenId }) }]);
  });

  it("refuses short, a name and a gender split as original text", async () => {
    expect((await first(ctxU, "places", { id: f.zone, short: "x" })).text).toEqual({
      status: "error",
      code: "invalid",
      message: 'short is original text; send it without a layer or with "layer": "original"',
    });
    expect((await first(ctxU, "places", { id: f.zone, name: "Unser Name" })).name).toEqual({
      status: "error",
      code: "invalid",
      message: 'a name is original text; send it without a layer or with "layer": "original"',
    });
    const split = await first(ctxU, "quests", {
      id: f.quest.lineId,
      variant: f.quest.variant,
      text: "Well met, $Glad:lass;.",
    });
    expect(split.text).toEqual({
      status: "error",
      code: "invalid",
      message: "an override cannot split a line by the reader's gender; that changes the original text",
    });
  });

  it("is refused on a line with no text in the language", async () => {
    expect((await first(ctxU, "places", { id: f.subzone, text: "Nichts." })).text).toEqual({
      status: "error",
      code: "invalid",
      message: `this line has no ${lang} text yet`,
    });
  });

  it("removes an override with a null text, and finds none the second time", async () => {
    expect((await first(ctxU, "bosses", { id: f.boss.lineId, text: "Unser Boss." })).text).toMatchObject({
      status: "updated",
    });
    expect((await first(ctxU, "bosses", { id: f.boss.lineId, text: null })).text).toMatchObject({
      status: "removed",
      layer: "override",
    });
    expect((await first(ctxU, "bosses", { id: f.boss.lineId, text: null })).text).toMatchObject({
      status: "unchanged",
    });
    expect(await overrideTeams("bosses", f.boss.lineId)).toEqual([]);
  });

  it("is told the original moved when expectedVersion is behind it", async () => {
    const version = (await sections.places.version(lang, f.zone, 0))!;
    const result = await first(ctxU, "places", { id: f.zone, text: "Später.", expectedVersion: version - 1 });
    expect(result.text).toEqual({
      status: "error",
      code: "conflict",
      message: `the original text is at version ${version}, not ${version - 1}`,
    });
    expect((await first(ctxU, "places", { id: f.zone, text: "Später.", expectedVersion: version })).text).toMatchObject({
      status: "updated",
      version,
    });
  });

  it("writes a quest override on the file the Explorer's rewrite writes", async () => {
    const lineId = welcome;
    const file = [...(await fileIndex(lang))].find(([, line]) => line.lineId === lineId)?.[0];
    expect(file).toBeTruthy();

    const result = await first(ctxU, "quests", { id: lineId, text: "Seid willkommen, Freund." });
    expect(result.text).toMatchObject({ status: "updated", layer: "override" });
    const { rows } = await asSystem.query(
      `select "file", "teamId" from "line_override" where "lang" = $1 and "lineId" = $2`,
      [lang, lineId],
    );
    expect(rows).toEqual([{ file, teamId: b }]);
    expect(await asActor(u.id, () => sections.quests.one(lang, lineId, 0))).toMatchObject({
      text: "Sei willkommen.",
      override: "Seid willkommen, Freund.",
    });
  });

  it("is refused a quest line the site lists only in another voice, writing nothing", async () => {
    const lineId = elsewhere;
    const ids = [...(await asActor(u.id, () => fileIndex(lang))).values()].map((line) => line.lineId);
    expect(ids).toContain(`${lineId}~${RACE}-female`);
    expect(ids).not.toContain(lineId);
    for (const text of ["Seid gegrüßt, Freund.", null]) {
      expect((await first(ctxU, "quests", { id: lineId, variant: 0, text })).text).toEqual({
        status: "error",
        code: "invalid",
        message: "this line is spoken in another voice; override it on the site",
      });
    }
    const { rows } = await asSystem.query(`select 1 from "line_override" where "lang" = $1 and "lineId" = $2`, [
      lang,
      lineId,
    ]);
    expect(rows).toEqual([]);
  });

  it.each([
    ["readables", "book_line"],
    ["quests", "quest_line"],
  ] as const)("removes a %s override whose original has since been retired", async (section, table) => {
    const [, listed] = [...(await fileIndex(lang))].find(([, line]) => /^q:\d+:complete$/.test(line.lineId))!;
    const lineId = section === "quests" ? listed.lineId : f.page.lineId;
    if (section === "quests") await saveQuestText({ lang, lineId, variant: 0, text: "Gut gemacht.", editedBy: m.id });
    expect((await first(ctxU, section, { id: lineId, text: "Unser Wort." })).text).toMatchObject({ status: "updated" });
    const retire = (current: boolean) =>
      asSystem.query(`update "${table}" set "isCurrent" = $1 where "lang" = $2 and "lineId" = $3`, [current, lang, lineId]);
    await retire(false);
    try {
      expect((await first(ctxU, section, { id: lineId, text: null })).text).toMatchObject({
        status: "removed",
        layer: "override",
      });
    } finally {
      await retire(true);
    }
    const left =
      section === "quests"
        ? (await asSystem.query(`select 1 from "line_override" where "lang" = $1 and "lineId" = $2`, [lang, lineId])).rows
        : await overrideTeams(section, lineId);
    expect(left).toEqual([]);
  });

  it("reads its team's override in each section, which the privileged team does not see", async () => {
    await first(ctxU, "readables", { id: f.page.lineId, text: "Unsere Seite." });
    const asU = await asActor(u.id, () => sections.readables.one(lang, f.page.lineId, 0));
    expect(asU).toMatchObject({ text: "Eine Seite.", override: "Unsere Seite." });
    expect(await asActor(m.id, () => sections.readables.one(lang, f.page.lineId, 0))).toMatchObject({
      text: "Eine Seite.",
      override: null,
    });
  });
});

describe("a text maintainer", () => {
  it("writes the original with the original layer, as before", async () => {
    const result = await first(ctxM, "places", { id: f.zone, text: "Neues Land." }, "original");
    expect(result.text).toMatchObject({ status: "updated", layer: "original" });
    expect(await loreFull()).toBe("Neues Land.");
  });
});
