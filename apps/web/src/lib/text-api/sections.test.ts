/**
 * Each section read and written through its adapter. Against a real Postgres, because what an
 * item says comes from the catalogues and the tables behind them.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { saveStory } from "@/lib/bosses/story";
import { closeDb, query } from "@/lib/db";
import { saveName } from "@/lib/names/store";
import { saveLore } from "@/lib/places/lore";
import { audioRelPath } from "@/lib/audio";
import { keepLanguage } from "@/lib/quests/keep-language";
import { clearOverride, writeOverride } from "@/lib/quests/overrides";
import { saveQuestText } from "@/lib/quests/text";
import { saveBookText } from "@/lib/readables/text";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem } from "@/lib/teams/testing";

import { sections } from "./index";
import { listSql } from "./quests";
import { parseList } from "./respond";
import { createFixtures, LANG, type Fixtures } from "./testing";
import type { Source } from "@/lib/sections";

import { keyOf, type Page, type TextItem } from "./types";

let f: Fixtures;

beforeAll(async () => {
  f = await createFixtures();
});

keepLanguage(LANG);

afterAll(async () => {
  await f.remove();
  await closeDb();
});

async function all(section: Source, filter: Record<string, string>, limit = 500): Promise<TextItem[]> {
  const items: TextItem[] = [];
  let cursor: string | null = null;
  do {
    const page: Page = await sections[section].list(LANG, filter, cursor, limit);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

describe("places", () => {
  it("lists an untranslated item with nulls and its English", async () => {
    expect((await all("places", { zone: String(f.map) })).find((i) => i.id === f.subzone)).toMatchObject({
      text: null,
      short: null,
      version: null,
      name: null,
      nameVersion: null,
      englishText: "English lore.",
      englishName: "Test Hollow",
      group: { kind: "subzone", mapID: f.map },
    });
  });

  it("lists a translated item with text, version, name and nameVersion", async () => {
    await saveLore({ lang: LANG, lineId: f.zone, full: "번역.", editedBy: f.user });
    await saveName({ kind: "zone", entityId: f.zone, lang: LANG, name: "시험의 땅", editedBy: f.user });
    expect(await sections.places.one(LANG, f.zone, 0)).toMatchObject({
      text: "번역.",
      version: 1,
      name: "시험의 땅",
      nameVersion: 1,
      englishText: "English lore.",
      englishName: "Testlands",
    });
  });

  it("filters by zone to the zone and its subzones", async () => {
    const ids = (await all("places", { zone: String(f.map) })).map((i) => i.id);
    expect(ids.sort()).toEqual([f.subzone, f.zone].sort());
  });

  it("pages in stable order, every item once", async () => {
    const whole = (await all("places", {})).map((i) => i.id);
    const paged = (await all("places", {}, 1)).map((i) => i.id);
    expect(paged).toEqual(whole);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it("names a zone by kind zone and a subzone by kind subzone", async () => {
    expect(await sections.places.nameTarget(LANG, f.zone, 0)).toEqual({ kind: "zone", entityId: f.zone });
    expect(await sections.places.nameTarget(LANG, f.subzone, 0)).toEqual({ kind: "subzone", entityId: f.subzone });
  });

  it("changing only short keeps the text", async () => {
    await saveLore({ lang: LANG, lineId: f.subzone, full: "긴 글.", editedBy: f.user });
    await sections.places.saveText({
      lang: LANG, id: f.subzone, variant: 0, short: "짧게.", note: null, by: f.user, expectedVersion: null, audit: { tokenId: "t" },
    });
    expect(await sections.places.one(LANG, f.subzone, 0)).toMatchObject({ text: "긴 글.", short: "짧게." });
  });

  it("resending the same short is no new version", async () => {
    const args = { lang: LANG, id: f.subzone, variant: 0, short: "또 짧게.", note: null, by: f.user, expectedVersion: null, audit: { tokenId: "t" } } as const;
    const first = await sections.places.saveText(args);
    expect((await sections.places.saveText(args)).version).toBe(first.version);
  });

  it("new text with the same short keeps that short", async () => {
    const args = { lang: LANG, id: f.subzone, variant: 0, note: null, by: f.user, expectedVersion: null, audit: { tokenId: "t" } } as const;
    await sections.places.saveText({ ...args, text: "옛 글.", short: "손으로 쓴 짧은 글." });
    await sections.places.saveText({ ...args, text: "새 글.", short: "손으로 쓴 짧은 글." });
    expect(await sections.places.one(LANG, f.subzone, 0)).toMatchObject({ text: "새 글.", short: "손으로 쓴 짧은 글." });
  });

  it("changing only short with no text yet is an error", async () => {
    const bare = await createFixtures();
    await expect(
      sections.places.saveText({
        lang: LANG, id: bare.zone, variant: 0, short: "짧게.", note: null, by: bare.user, expectedVersion: null, audit: { tokenId: "t" },
      }),
    ).rejects.toThrow(/no text/);
    await bare.remove();
  });
});

describe("bosses", () => {
  it("lists with English story and filters by instance", async () => {
    await asSystem.query(
      `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text") values ($1, 'enUS', 1, true, 'rewritten', 'English story.')`,
      [f.boss.id],
    );
    const items = await all("bosses", { instance: String(f.map) });
    expect(items.map((i) => i.id)).toEqual([f.boss.lineId]);
    expect(items[0]).toMatchObject({
      text: null,
      englishText: "English story.",
      englishName: "Test Boss",
      name: null,
      group: { bossId: f.boss.id, map: f.map },
    });
  });

  it("carries version once written", async () => {
    await saveStory({ lang: LANG, lineId: f.boss.lineId, text: "이야기.", editedBy: f.user });
    expect(await sections.bosses.one(LANG, f.boss.lineId, 0)).toMatchObject({ text: "이야기.", version: 1 });
  });

  it("refuses a retired boss as known", async () => {
    await asSystem.query(`update "boss" set "retired" = true where "id" = $1`, [f.boss.id]);
    expect((await sections.bosses.known(LANG, [{ id: f.boss.lineId, variant: 0 }])).size).toBe(0);
    await asSystem.query(`update "boss" set "retired" = false where "id" = $1`, [f.boss.id]);
    expect((await sections.bosses.known(LANG, [{ id: f.boss.lineId, variant: 0 }])).has(keyOf(f.boss.lineId, 0))).toBe(true);
  });
});

describe("readables", () => {
  it("filters by book and names the page's owner", async () => {
    await saveBookText({ lang: LANG, lineId: f.page.lineId, text: "페이지.", editedBy: f.user });
    const items = await all("readables", { book: f.page.bookId });
    expect(items.map((i) => i.id)).toEqual([f.page.lineId]);
    expect(items[0]).toMatchObject({ text: "페이지.", version: 1, englishText: "English page.", group: { bookId: f.page.bookId, pageNumber: 1 } });
    expect(await sections.readables.nameTarget(LANG, f.page.lineId, 0)).toEqual({ kind: "item", entityId: String(f.page.ownerId) });
  });

  it("has no name target for a page with no owner", async () => {
    expect(await sections.readables.nameTarget(LANG, f.ownerlessPage.lineId, 0)).toBeNull();
  });
});

describe("quests", () => {
  it("lists an untranslated line with text null and its English", async () => {
    expect(await sections.quests.one(LANG, f.quest.lineId, f.quest.variant)).toMatchObject({
      id: f.quest.lineId,
      variant: f.quest.variant,
      text: null,
      version: null,
      name: null,
      group: { questId: f.quest.questId, source: "accept" },
    });
    expect((await sections.quests.one(LANG, f.quest.lineId, f.quest.variant))!.englishText).toBeTruthy();
  });

  it("carries text, version and name once written", async () => {
    await saveQuestText({ lang: LANG, lineId: f.quest.lineId, variant: f.quest.variant, text: "번역.", editedBy: f.user });
    await saveName({ kind: "quest", entityId: String(f.quest.questId), lang: LANG, name: "퀘스트", editedBy: f.user });
    expect(await sections.quests.one(LANG, f.quest.lineId, f.quest.variant)).toMatchObject({
      text: "번역.",
      version: 1,
      name: "퀘스트",
      nameVersion: 1,
    });
  });

  it("carries what the line is spoken as, in the list and alone, until the rewrite is dropped", async () => {
    const { lineId, variant, questId } = f.quest;
    await saveQuestText({ lang: LANG, lineId, variant, text: "번역.", editedBy: f.user });
    const [row] = await query<{ fileName: string }>(
      `select "fileName" from "quest_line" where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [lineId, variant, LANG],
    );
    const file = audioRelPath({ lineId, fileName: row.fileName });
    const listed = async () => (await all("quests", { quest: String(questId) })).find((i) => i.id === lineId);

    expect(await sections.quests.one(LANG, lineId, variant)).toMatchObject({ override: null });

    await writeOverride(LANG, file, lineId, "다시 쓴 번역.", f.user);
    try {
      expect(await sections.quests.one(LANG, lineId, variant)).toMatchObject({ text: "번역.", override: "다시 쓴 번역." });
      expect(await listed()).toMatchObject({ text: "번역.", override: "다시 쓴 번역." });
    } finally {
      await clearOverride(LANG, file, f.user);
    }

    expect(await sections.quests.one(LANG, lineId, variant)).toMatchObject({ text: "번역.", override: null });
  });

  it("filters by quest and by source", async () => {
    const lines = await all("quests", { quest: String(f.quest.questId) });
    expect(lines.some((i) => i.id === f.quest.lineId)).toBe(true);
    expect(lines.every((i) => i.group.questId === f.quest.questId)).toBe(true);

    const gossip = (await sections.quests.list(LANG, { source: "gossip" }, null, 50)).items;
    expect(gossip.length).toBeGreaterThan(0);
    expect(gossip.every((i) => i.group.source === "gossip")).toBe(true);
  });

  it("pages in stable order across a page boundary", async () => {
    const first = await sections.quests.list(LANG, {}, null, 3);
    const second = await sections.quests.list(LANG, {}, first.nextCursor, 3);
    expect(first.items).toHaveLength(3);
    const ids = [...first.items, ...second.items].map((i) => keyOf(i.id, i.variant ?? 0));
    expect(new Set(ids).size).toBe(6);
    const merged = await sections.quests.list(LANG, {}, null, 6);
    expect(merged.items.map((i) => keyOf(i.id, i.variant ?? 0))).toEqual(ids);
  });

  // A page's own text is looked up per item; a scan of the table reads every language.
  it.each([
    ["no filter", {}],
    ["a quest", () => ({ quest: String(f.quest.questId) })],
    ["a source", { source: "gossip" }],
  ])("never scans quest_line for its text for %s", async (_name, filter) => {
    const sql = listSql(typeof filter === "function" ? filter() : filter, null, 500, LANG);
    expect((await query(`explain ${sql.text}`, sql.params)).map((row) => row["QUERY PLAN"]).join("\n")).not.toMatch(
      /Seq Scan on quest_line t\b/,
    );
  });

  it("applies a quest filter when reading the language's rows, not after", async () => {
    const sql = listSql({ quest: String(f.quest.questId) }, null, 500, LANG);
    const own = sql.text.slice(sql.text.indexOf(`"own" as`), sql.text.indexOf(`"lines" as`));
    expect(own).toContain(`"questId" =`);
  });

  it("filters by a quest's level, leaving out lines with none", async () => {
    const quest = f.quest.questId!;
    await query(
      `insert into "quest_level" ("questId", "level") values ($1, 12)
       on conflict ("questId") do update set "level" = 12`,
      [quest],
    );
    const ids = async (filter: Record<string, string>) =>
      (await sections.quests.list(LANG, filter, null, 500)).items.map((item) => item.id);

    expect(await ids({ quest: String(quest), minLevel: "12", maxLevel: "12" })).toContain(f.quest.lineId);
    expect(await ids({ quest: String(quest), minLevel: "13" })).toEqual([]);
    expect(await ids({ quest: String(quest), maxLevel: "11" })).toEqual([]);
    expect(await ids({ source: "gossip", minLevel: "0" })).toEqual([]);
    await query(`delete from "quest_level" where "questId" = $1`, [quest]);
  });

  it("refuses a level that is not a number", () => {
    const parsed = parseList(sections.quests, new URLSearchParams("minLevel=low"));
    expect(parsed).toBeInstanceOf(Response);
  });

  it("keeps two variants of one line id as two items", async () => {
    const [row] = await query<{ lineId: string }>(
      `select "lineId" from "quest_line" where "lang" = 'enUS' and "isCurrent" and "variant" > 0 order by 1 limit 1`,
    );
    expect(await sections.quests.one(LANG, row.lineId, 0)).not.toBeNull();
    expect(await sections.quests.one(LANG, row.lineId, 1)).not.toBeNull();
  });

  it("a gossip line has name null and no name target", async () => {
    expect(await sections.quests.one(LANG, f.gossip.lineId, f.gossip.variant)).toMatchObject({ name: null, englishName: null });
    expect(await sections.quests.nameTarget(LANG, f.gossip.lineId, f.gossip.variant)).toBeNull();
  });

  describe("an English-split moment the language has no text for", () => {
    const moment = async () => {
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

    it("lists :m and :f, not the plain id", async () => {
      const m = await moment();
      expect(await sections.quests.one(LANG, `${m}:m`, 0)).toMatchObject({ text: null });
      expect(await sections.quests.one(LANG, `${m}:f`, 0)).toMatchObject({ text: null });
      expect(await sections.quests.one(LANG, m, 0)).toBeNull();
    });

    it("known() accepts the sides and refuses the plain id", async () => {
      const m = await moment();
      const known = await sections.quests.known(LANG, [
        { id: `${m}:m`, variant: 0 },
        { id: m, variant: 0 },
      ]);
      expect(known.has(keyOf(`${m}:m`, 0))).toBe(true);
      expect(known.has(keyOf(m, 0))).toBe(false);
    });

    it("plain text to a side is refused and writes nothing", async () => {
      const m = await moment();
      await expect(
        sections.quests.saveText({
          lang: LANG, id: `${m}:m`, variant: 0, text: "평문.", note: null, by: f.user, expectedVersion: null, audit: { tokenId: "t" },
        }),
      ).rejects.toThrow(/\$G/);
      expect(await sections.quests.one(LANG, `${m}:m`, 0)).toMatchObject({ text: null });
    });

    it("$G text returns both sides as the lines written", async () => {
      const m = await moment();
      const saved = await sections.quests.saveText({
        lang: LANG, id: `${m}:m`, variant: 0, text: "$G남자:여자;", note: null, by: f.user, expectedVersion: null, audit: { tokenId: "t" },
      });
      expect(saved.lines.sort()).toEqual([`${m}:f`, `${m}:m`]);
    });
  });

  it("known() refuses a typo", async () => {
    expect((await sections.quests.known(LANG, [{ id: "q:0:nothing", variant: 0 }])).size).toBe(0);
  });
});

describe("a language nobody owns", () => {
  it("lists rather than answering empty", async () => {
    await asSystem.query(`update "team_language" set "privileged" = false where "lang" = $1`, [LANG]);
    forgetTeams();
    try {
      expect((await sections.quests.list(LANG, {}, null, 1)).items).toHaveLength(1);
      expect((await sections.places.list(LANG, { zone: String(f.map) }, null, 1)).items).toHaveLength(1);
    } finally {
      await asSystem.query(`update "team_language" set "privileged" = true where "lang" = $1`, [LANG]);
      forgetTeams();
    }
  });
});
