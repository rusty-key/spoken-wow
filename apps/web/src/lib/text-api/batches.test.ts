/**
 * Undoing a mass update, against a real Postgres: what undo does depends on the versions and live
 * flags the run left behind.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fileIndex } from "@/lib/audio";
import { saveStory, StoryConflict } from "@/lib/bosses/story";
import { closeDb, query } from "@/lib/db";
import { viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { saveLore } from "@/lib/places/lore";
import { keepLanguage } from "@/lib/quests/keep-language";
import { saveQuestText } from "@/lib/quests/text";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { applyItem, applyItems } from "./apply";
import { createBatch, getBatch, listBatches, restoreBatch as undo } from "./batches";
import { Refused } from "./errors";
import { backedScopes, type Layer, type TokenContext } from "./guard";
import { sections } from "./index";
import { createFixtures, LANG, type Fixtures } from "./testing";
import { keyOf } from "./types";
import type { Source } from "@/lib/sections";

let f: Fixtures;
let context: TokenContext;

beforeEach(async () => {
  f = await createFixtures();
  const { row } = await createToken({
    userId: f.user,
    lang: LANG,
    access: "write",
    generate: false,
    label: "agent",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  context = { tokenId: row.id, userId: f.user, role: null, lang: LANG, access: "write", generate: false, layers: { original: true, override: false } };
  return () => f.remove();
});

keepLanguage(LANG);

afterAll(async () => {
  await closeDb();
});

const run = (section: Source, items: unknown[]) => applyItems(section, context, items, null, "original");
const BOTH = { original: true, override: true };
const restoreBatch = async (batchId: string, by: string) => undo((await getBatch(batchId))!, by, BOTH);
const textOf = async (section: Source, id: string, variant = 0) => (await sections[section].one(LANG, id, variant))?.text;

describe("restoreBatch", () => {
  it("puts back the version a batch replaced", async () => {
    await run("bosses", [{ id: f.boss.lineId, text: "원래." }]);
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, text: "나쁜 글." }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: f.boss.lineId, field: "text", status: "restored" },
    ]);
    expect(await textOf("bosses", f.boss.lineId)).toBe("원래.");
  });

  it("uses the version replaced, not the number below it", async () => {
    await run("places", [{ id: f.zone, text: "하나." }]);
    await run("places", [{ id: f.zone, text: "둘." }]);
    const { batchId: second } = await run("places", [{ id: f.zone, text: "셋." }]);
    await restoreBatch(second, f.user);
    expect(await textOf("places", f.zone)).toBe("둘.");

    const { batchId: third } = await run("places", [{ id: f.zone, text: "넷." }]);
    await restoreBatch(third, f.user);
    expect(await textOf("places", f.zone)).toBe("둘.");
  });

  it.each([
    ["places", () => f.zone],
    ["bosses", () => f.boss.lineId],
    ["readables", () => f.page.lineId],
  ] as const)("retires a first translation in %s, so the line reads untranslated", async (section, id) => {
    const { batchId } = await run(section, [{ id: id(), text: "첫 번역." }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([{ id: id(), field: "text", status: "retired" }]);
    expect(await textOf(section, id())).toBeNull();
  });

  it("retires a first translation of a quest line, carrying its variant", async () => {
    const { lineId: id, variant } = f.quest;
    const { batchId } = await run("quests", [{ id, variant, text: "첫 번역." }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([{ id, variant, field: "text", status: "retired" }]);
    expect(await textOf("quests", id, variant)).toBeNull();
  });

  it("undoes two names a run gave one entity, back to none", async () => {
    const batchId = await createBatch({
      userId: f.user,
      tokenId: context.tokenId,
      lang: LANG,
      section: "bosses",
      itemCount: 2,
      note: null,
    });
    const known = new Set([keyOf(f.boss.lineId, 0)]);
    const audit = { tokenId: context.tokenId, batchId };
    await applyItem("bosses", context, { id: f.boss.lineId, name: "첫 이름" }, known, audit, "original");
    await applyItem("bosses", context, { id: f.boss.lineId, name: "둘째 이름" }, known, audit, "original");

    expect((await restoreBatch(batchId, f.user)).map((r) => r.status)).toEqual(["restored", "retired"]);
    expect((await sections.bosses.one(LANG, f.boss.lineId, 0))?.name).toBeNull();
  });

  it("restores a name by moving back to its version, writing none", async () => {
    await run("bosses", [{ id: f.boss.lineId, name: "옛 이름" }]);
    const before = (await sections.bosses.one(LANG, f.boss.lineId, 0))?.nameVersion;
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, name: "나쁜 이름" }]);

    const entity = { kind: "boss", entityId: String(f.boss.id) };
    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: entity.entityId, entity, field: "name", status: "restored" },
    ]);
    expect(await sections.bosses.one(LANG, f.boss.lineId, 0)).toMatchObject({ name: "옛 이름", nameVersion: before });
  });

  it("names a name's undo by its entity id when it is skipped", async () => {
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, name: "실행 이름" }]);
    await run("bosses", [{ id: f.boss.lineId, name: "나중 이름" }]);

    const entity = { kind: "boss", entityId: String(f.boss.id) };
    expect(await restoreBatch(batchId, f.user)).toMatchObject([
      { id: entity.entityId, entity, field: "name", status: "skipped", reason: "edited_since" },
    ]);
    expect((await sections.bosses.one(LANG, f.boss.lineId, 0))?.name).toBe("나중 이름");
  });

  it("does not hand a database's message to the caller", async () => {
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, text: "글." }]);
    const driver = Object.assign(new Error('duplicate key violates "boss_line_current"'), { code: "23505" });
    const spy = vi.spyOn(sections.bosses, "version").mockRejectedValueOnce(driver);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const [result] = await restoreBatch(batchId, f.user);
    spy.mockRestore();
    logged.mockRestore();

    expect(result).toMatchObject({ status: "skipped", reason: "error" });
    expect(result.message).not.toContain("boss_line_current");
  });

  it("reports a conflict while writing as edited since", async () => {
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, text: "첫 글." }]);
    const spy = vi.spyOn(sections.bosses, "retire").mockRejectedValueOnce(new StoryConflict("moved"));

    const [result] = await restoreBatch(batchId, f.user);
    spy.mockRestore();

    expect(result).toMatchObject({ status: "skipped", reason: "edited_since" });
  });

  it("retires a first name, so the English shows again", async () => {
    const { batchId } = await run("places", [{ id: f.zone, name: "첫 이름" }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: f.zone, entity: { kind: "zone", entityId: f.zone }, field: "name", status: "retired" },
    ]);
    expect((await sections.places.one(LANG, f.zone, 0))?.name).toBeNull();
  });

  it("names a subzone's undo by its whole id, colons and all", async () => {
    await run("places", [{ id: f.subzone, name: "옛 이름" }]);
    const { batchId } = await run("places", [{ id: f.subzone, name: "나쁜 이름" }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: f.subzone, entity: { kind: "subzone", entityId: f.subzone }, field: "name", status: "restored" },
    ]);
  });

  it("skips a line edited since, leaving that edit", async () => {
    await run("readables", [{ id: f.page.lineId, text: "원래." }]);
    const { batchId } = await run("readables", [{ id: f.page.lineId, text: "묶음." }]);
    await run("readables", [{ id: f.page.lineId, text: "사람이 고침." }]);

    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: f.page.lineId, field: "text", status: "skipped", reason: "edited_since" },
    ]);
    expect(await textOf("readables", f.page.lineId)).toBe("사람이 고침.");
  });

  const splitMoment = async () => {
    const [row] = await query<{ moment: string }>(
      `select regexp_replace(e."lineId", ':[mf]$', '') as "moment" from "quest_line" e
        where e."lang" = 'enUS' and e."isCurrent" and e."variant" = 0 and e."lineId" ~ ':m$'
          and not exists (select 1 from "quest_line" k
                           where regexp_replace(k."lineId", ':[mf]$', '') = regexp_replace(e."lineId", ':[mf]$', '')
                             and k."lang" = $1)
        order by 1 limit 1`,
      [LANG],
    );
    return row.moment;
  };

  it("skips a first $G write, reason gender_split", async () => {
    const moment = await splitMoment();
    const { batchId } = await run("quests", [{ id: `${moment}:m`, text: "$G남자:여자;" }]);

    const results = await restoreBatch(batchId, f.user);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "skipped" && r.reason === "gender_split")).toBe(true);
    expect(await sections.quests.version(LANG, `${moment}:m`, 0)).toBe(1);
  });

  it("skips a $G save over plain text, reason gender_split", async () => {
    const { lineId: id, variant } = f.quest;
    await run("quests", [{ id, variant, text: "평문." }]);
    const { batchId } = await run("quests", [{ id, variant, text: "$G남자:여자;" }]);

    const results = await restoreBatch(batchId, f.user);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "skipped" && r.reason === "gender_split")).toBe(true);
    expect(await sections.quests.version(LANG, `${id}:m`, variant)).toBe(1);
  });

  it("run twice: the second changes nothing and reports all skipped", async () => {
    await run("bosses", [{ id: f.boss.lineId, text: "원래." }]);
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, text: "묶음." }]);
    await restoreBatch(batchId, f.user);
    const version = await sections.bosses.version(LANG, f.boss.lineId, 0);

    expect(await restoreBatch(batchId, f.user)).toEqual([
      { id: f.boss.lineId, field: "text", status: "skipped", reason: "edited_since" },
    ]);
    expect(await sections.bosses.version(LANG, f.boss.lineId, 0)).toBe(version);
  });

  it("finds the batch's rows in a language no team owns", async () => {
    await asSystem.query(`update "team_language" set "privileged" = false where "lang" = $1`, [LANG]);
    forgetTeams();
    try {
      const { batchId } = await run("places", [{ id: f.zone, text: "주인 없음." }]);
      expect(await restoreBatch(batchId, f.user)).toEqual([{ id: f.zone, field: "text", status: "retired" }]);
    } finally {
      await asSystem.query(`update "team_language" set "privileged" = true where "lang" = $1`, [LANG]);
      forgetTeams();
    }
  });

  it("one failing line does not stop the rest", async () => {
    const { batchId } = await run("places", [
      { id: f.zone, text: "하나." },
      { id: f.subzone, text: "둘." },
    ]);
    const spy = vi.spyOn(sections.places, "retire").mockRejectedValueOnce(new Refused("boom"));

    const results = await restoreBatch(batchId, f.user);
    spy.mockRestore();

    expect(results.map((r) => r.status).sort()).toEqual(["retired", "skipped"]);
    expect(results.find((r) => r.status === "skipped")).toMatchObject({ reason: "error", message: "boom" });
  });
});

describe("restoreBatch on overrides", () => {
  let g: Fixtures;
  let lang: Lang;
  let a: TeamId;
  let b: TeamId;
  let questLine: string;
  const people: Record<"u" | "owner" | "p", { id: string; cleanup: () => Promise<void> }> = {} as never;

  const layersOf = async (userId: string) =>
    backedScopes(await viewerOf({ user: { id: userId, role: null } }), lang, "write", false).layers;

  async function contextOf(userId: string): Promise<TokenContext> {
    const { row } = await createToken({
      userId,
      lang,
      access: "write",
      generate: false,
      label: "agent",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return { tokenId: row.id, userId, role: null, lang, access: "write", generate: false, layers: await layersOf(userId) };
  }

  const write = async (ctx: TokenContext, section: Source, items: unknown[], layer: Layer = "override") =>
    (await asActor(ctx.userId, () => applyItems(section, ctx, items, null, layer))).batchId;

  const restoreAs = (userId: string, batchId: string, layers: Record<Layer, boolean>) =>
    asActor(userId, async () => undo((await getBatch(batchId))!, userId, layers));

  const narrated = async (source: string, lineId: string) =>
    (
      await asSystem.query<{ teamId: string; text: string }>(
        `select "teamId", "text" from "text_override" where "lang" = $1 and "source" = $2 and "lineId" = $3`,
        [lang, source, lineId],
      )
    ).rows;

  beforeAll(async () => {
    g = await createFixtures();
    lang = await uniqueLang();
    a = await newTeamIn(lang, true, "undo-a");
    b = await newTeamIn(lang, false, "undo-b");
    people.u = await testUser("test-undo-u");
    people.owner = await testUser("test-undo-owner");
    people.p = await testUser("test-undo-p");
    await addMember(b, people.u.id, lang, "regenerate");
    await addMember(a, people.owner.id, lang, "regenerate");
    await addMember(a, people.p.id, lang, "regenerate");
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [people.owner.id]);
    await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [
      people.p.id,
      lang,
    ]);
    forgetTeams();

    const by = people.owner.id;
    await saveLore({ lang, lineId: g.zone, full: "Unser Land.", editedBy: by });
    await saveLore({ lang, lineId: g.subzone, full: "Unser Tal.", editedBy: by });
    await saveStory({ lang, lineId: g.boss.lineId, text: "Der Boss spricht.", editedBy: by });
    // A line the Explorer lists under its own id, so the API may override it.
    const [, listed] = [...(await fileIndex(lang))].find(([, line]) => /^q:\d+:accept$/.test(line.lineId))!;
    questLine = listed.lineId;
    await saveQuestText({ lang, lineId: questLine, variant: 0, text: "Sei willkommen.", editedBy: by });
  });

  beforeEach(async () => {
    await asSystem.query(`delete from "text_override" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "line_override" where "lang" = $1`, [lang]);
  });

  afterAll(async () => {
    for (const table of ["text_override", "line_override", "quest_line", "lore_line", "boss_line", "api_batch", "api_token"]) {
      await asSystem.query(`delete from "${table}" where "lang" = $1`, [lang]);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    for (const team of [a, b]) await dropTeam(team);
    for (const person of Object.values(people)) await person.cleanup();
    await dropLang(lang);
    forgetTeams();
    await g.remove();
  });

  it("puts back an override the batch replaced and clears one it made", async () => {
    const ctxU = await contextOf(people.u.id);
    await write(ctxU, "places", [{ id: g.zone, text: "Alt." }]);
    const batchId = await write(ctxU, "places", [
      { id: g.zone, text: "Neu." },
      { id: g.subzone, text: "Ganz neu." },
    ]);

    const results = await restoreAs(people.u.id, batchId, ctxU.layers);
    expect(results).toEqual(
      expect.arrayContaining([
        { id: g.zone, field: "override", status: "restored" },
        { id: g.subzone, field: "override", status: "retired" },
      ]),
    );
    expect(results).toHaveLength(2);
    expect(await narrated("places", g.zone)).toEqual([{ teamId: b, text: "Alt." }]);
    expect(await narrated("places", g.subzone)).toEqual([]);
  });

  it("clears a quest override the batch made, carrying its variant", async () => {
    const ctxU = await contextOf(people.u.id);
    const batchId = await write(ctxU, "quests", [{ id: questLine, text: "Seid willkommen, Freund." }]);

    expect(await restoreAs(people.u.id, batchId, ctxU.layers)).toEqual([
      { id: questLine, variant: 0, field: "override", status: "retired" },
    ]);
    const { rows } = await asSystem.query(`select 1 from "line_override" where "lang" = $1`, [lang]);
    expect(rows).toEqual([]);
  });

  it("restores a second team's batch for a site owner into that team, giving theirs none", async () => {
    const ctxU = await contextOf(people.u.id);
    await write(ctxU, "bosses", [{ id: g.boss.lineId, text: "Alt." }]);
    const batchId = await write(ctxU, "bosses", [{ id: g.boss.lineId, text: "Neu." }]);

    expect(await restoreAs(people.owner.id, batchId, { original: true, override: true })).toEqual([
      { id: g.boss.lineId, field: "override", status: "restored" },
    ]);
    expect(await narrated("bosses", g.boss.lineId)).toEqual([{ teamId: b, text: "Alt." }]);
  });

  it("skips an override edited since the batch", async () => {
    const ctxU = await contextOf(people.u.id);
    const batchId = await write(ctxU, "places", [{ id: g.zone, text: "Vom Lauf." }]);
    await write(ctxU, "places", [{ id: g.zone, text: "Von Hand." }]);

    expect(await restoreAs(people.u.id, batchId, ctxU.layers)).toEqual([
      { id: g.zone, field: "override", status: "skipped", reason: "edited_since" },
    ]);
    expect(await narrated("places", g.zone)).toEqual([{ teamId: b, text: "Von Hand." }]);
  });

  it("skips an override edit for one who may not write overrides", async () => {
    const ctxU = await contextOf(people.u.id);
    const batchId = await write(ctxU, "places", [{ id: g.zone, text: "Bleibt." }]);

    expect(await restoreAs(people.u.id, batchId, { original: true, override: false })).toEqual([
      { id: g.zone, field: "override", status: "skipped", reason: "not_allowed" },
    ]);
    expect(await narrated("places", g.zone)).toEqual([{ teamId: b, text: "Bleibt." }]);
  });

  it("skips the original edits of one who has since lost text and kept regenerate", async () => {
    const ctxP = await contextOf(people.p.id);
    expect(ctxP.layers).toEqual({ original: true, override: true });
    const batchId = await write(ctxP, "bosses", [{ id: g.boss.lineId, text: "Vom Lauf.", name: "Lauf-Name" }], "original");
    await asSystem.query(`delete from "language_grant" where "userId" = $1 and "lang" = $2`, [people.p.id, lang]);
    const layers = await layersOf(people.p.id);
    expect(layers).toEqual({ original: false, override: true });

    const results = await restoreAs(people.p.id, batchId, layers);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "skipped" && r.reason === "not_allowed")).toBe(true);
    expect(await sections.bosses.one(lang, g.boss.lineId, 0)).toMatchObject({ text: "Vom Lauf.", name: "Lauf-Name" });
  });
});

describe("listBatches", () => {
  it("lists a run newest first, with its section and size", async () => {
    await run("places", [{ id: f.zone, text: "하나." }]);
    const { batchId } = await run("bosses", [{ id: f.boss.lineId, text: "둘." }]);
    const batches = await listBatches(f.user, LANG);
    expect(batches[0]).toMatchObject({ id: batchId, section: "bosses", itemCount: 1 });
    expect(batches).toHaveLength(2);
  });
});
