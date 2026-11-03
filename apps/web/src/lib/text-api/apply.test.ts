/**
 * One item written through the API. Against a real Postgres, because what each result reports
 * has to match the rows the save functions wrote.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, query } from "@/lib/db";
import { keepLanguage } from "@/lib/quests/keep-language";
import type { Source } from "@/lib/sections";
import { asSystem } from "@/lib/teams/testing";

import { applyItem, MAX_NAME, MAX_TEXT, type ItemInput } from "./apply";
import type { TokenContext } from "./guard";
import { sections } from "./index";
import { createFixtures, LANG, type Fixtures } from "./testing";
import { keyOf } from "./types";

let f: Fixtures;
let context: TokenContext;
const AUDIT = { tokenId: "t" };

beforeAll(async () => {
  f = await createFixtures();
  context = { tokenId: "t", userId: f.user, role: null, lang: LANG, access: "write" };
});

keepLanguage(LANG);

afterAll(async () => {
  await f.remove();
  await closeDb();
});

function apply(section: Source, input: ItemInput, ctx = context) {
  const known = new Set([keyOf(input.id, typeof input.variant === "number" ? input.variant : 0)]);
  return applyItem(section, ctx, input, known, AUDIT);
}

describe("text", () => {
  it("updates and returns the new version", async () => {
    const before = (await sections.bosses.version(LANG, f.boss.lineId, 0)) ?? 0;
    expect(await apply("bosses", { id: f.boss.lineId, text: "새 이야기." })).toMatchObject({
      id: f.boss.lineId,
      text: { status: "updated", version: before + 1, lines: [f.boss.lineId] },
    });
  });

  it("resending the same text is unchanged, with the same version", async () => {
    const first = await apply("readables", { id: f.page.lineId, text: "같은 글." });
    const again = await apply("readables", { id: f.page.lineId, text: "같은 글." });
    expect(again.text).toMatchObject({ status: "unchanged", version: (first.text as { version: number }).version });
  });

  it("an expectedVersion that does not match is conflict and writes nothing", async () => {
    await apply("places", { id: f.subzone, text: "처음." });
    const result = await apply("places", { id: f.subzone, text: "둘째.", expectedVersion: 99 });
    expect(result.text).toMatchObject({ status: "error", code: "conflict" });
    expect(await sections.places.one(LANG, f.subzone, 0)).toMatchObject({ text: "처음." });
  });

  it("resending a place's text with an empty short is unchanged", async () => {
    const first = await apply("places", { id: f.zone, text: "빈 요약." });
    const again = await apply("places", { id: f.zone, text: "빈 요약.", short: "" });
    expect(again.text).toMatchObject({ status: "unchanged", version: (first.text as { version: number }).version });
  });

  it("an unknown id is unknown_id", async () => {
    const result = await applyItem("places", context, { id: "z:nothing", text: "글." }, new Set(), AUDIT);
    expect(result.error).toMatchObject({ code: "unknown_id" });
  });

  it.each([
    ["empty text", { text: "   " }],
    ["text that is no string", { text: 5 }],
    ["text over the limit", { text: "x".repeat(MAX_TEXT + 1) }],
    ["nothing to change", {}],
    ["a note that is no string", { text: "글.", note: 1 }],
    ["an expectedVersion that is no integer", { text: "글.", expectedVersion: "2" }],
    ["short on a section that has none", { text: "글.", short: "짧게." }],
    ["variant on a section that has none", { text: "글.", variant: 1 }],
  ])("%s is invalid", async (_name, change) => {
    const result = await apply("bosses", { id: f.boss.lineId, ...change });
    expect(result.error ?? result.text).toMatchObject({ code: "invalid" });
  });

  it("a variant that is no whole number is invalid", async () => {
    const result = await apply("quests", { id: f.quest.lineId, text: "글.", variant: -1 });
    expect(result.error).toMatchObject({ code: "invalid" });
  });

  it("a database error is internal, not invalid", async () => {
    const spy = vi.spyOn(sections.bosses, "saveText").mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "57014" }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await apply("bosses", { id: f.boss.lineId, text: "글." });
    expect(result.text).toMatchObject({ status: "error", code: "internal" });
    spy.mockRestore();
    logged.mockRestore();
  });
});

describe("errors", () => {
  it("a plain error from the driver is internal, not the caller's input", async () => {
    const pool = new Error("timeout exceeded when trying to connect");
    const spy = vi.spyOn(sections.bosses, "saveText").mockRejectedValueOnce(pool);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await apply("bosses", { id: f.boss.lineId, text: "글." });
    expect(result.text).toMatchObject({ status: "error", code: "internal" });
    spy.mockRestore();
    logged.mockRestore();
  });

  it("a bug is internal, not the caller's input", async () => {
    const spy = vi.spyOn(sections.bosses, "saveText").mockRejectedValueOnce(new TypeError("x is not a function"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await apply("bosses", { id: f.boss.lineId, text: "글." });
    expect(result.text).toMatchObject({ status: "error", code: "internal" });
    expect((result.text as { message: string }).message).not.toContain("not a function");
    spy.mockRestore();
    logged.mockRestore();
  });
});

describe("what a store would choke on", () => {
  it.each([
    ["a NUL in text", { text: "글\u0000." }],
    ["a NUL in a note", { text: "글.", note: "메\u0000모" }],
  ])("%s is invalid", async (_name, change) => {
    const result = await apply("bosses", { id: f.boss.lineId, ...change });
    expect(result.error ?? result.text).toMatchObject({ code: "invalid" });
  });

  it("a NUL in a name is invalid", async () => {
    const result = await apply("bosses", { id: f.boss.lineId, name: "이\u0000름" });
    expect(result.name).toMatchObject({ status: "error", code: "invalid" });
  });

  it("a variant too big to store is invalid", async () => {
    const result = await apply("quests", { id: f.quest.lineId, text: "글.", variant: 40000 });
    expect(result.error).toMatchObject({ code: "invalid" });
  });
});

describe("name", () => {
  it("updates independently of text: a bad name leaves the text saved", async () => {
    const result = await apply("bosses", { id: f.boss.lineId, text: "이야기와 이름.", name: "x".repeat(MAX_NAME + 1) });
    expect(result.text).toMatchObject({ status: "updated" });
    expect(result.name).toMatchObject({ status: "error", code: "invalid" });
  });

  it("expectedNameVersion guards the name, not expectedVersion", async () => {
    await apply("bosses", { id: f.boss.lineId, name: "이름" });
    const conflict = await apply("bosses", { id: f.boss.lineId, name: "새 이름", expectedNameVersion: 99 });
    expect(conflict.name).toMatchObject({ status: "error", code: "conflict" });

    const textVersionIgnored = await apply("bosses", { id: f.boss.lineId, name: "또 새 이름", expectedVersion: 99 });
    expect(textVersionIgnored.name).toMatchObject({ status: "updated" });
  });

  it("resending the same name is unchanged", async () => {
    await apply("places", { id: f.zone, name: "같은 이름" });
    expect((await apply("places", { id: f.zone, name: "같은 이름" })).name).toMatchObject({ status: "unchanged" });
  });

  it("is invalid on a readable page with no owner", async () => {
    const result = await apply("readables", { id: f.ownerlessPage.lineId, name: "제목" });
    expect(result.name).toMatchObject({ status: "error", code: "invalid" });
  });

  it("is invalid on a gossip line", async () => {
    const result = await apply("quests", { id: f.gossip.lineId, variant: f.gossip.variant, name: "이름" });
    expect(result.name).toMatchObject({ status: "error", code: "invalid" });
  });

  it("reports the entity a readable page's name wrote to", async () => {
    const result = await apply("readables", { id: f.page.lineId, name: "책 이름" });
    expect(result.name).toMatchObject({ status: "updated", entity: { kind: "item", entityId: String(f.page.ownerId) } });
  });
});

describe("gender", () => {
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

  it("$G text reports both lines", async () => {
    const moment = await splitMoment();
    const result = await apply("quests", { id: `${moment}:m`, text: "$G남자:여자;" });
    const lines = (result.text as { lines: string[] }).lines;
    expect(lines.sort()).toEqual([`${moment}:f`, `${moment}:m`]);
  });

  it("$G over a first plain version reports updated, though the new line is also version 1", async () => {
    const { lineId: id, variant } = f.quest;
    await apply("quests", { id, variant, text: "평문." });
    const result = await apply("quests", { id, variant, text: "$G남자:여자;" });
    expect(result.text).toMatchObject({ status: "updated", lines: expect.arrayContaining([`${id}:m`, `${id}:f`]) });
  });

  it("resending $G text to a split moment is unchanged and spends no version", async () => {
    const moment = await splitMoment();
    const first = await apply("quests", { id: `${moment}:m`, text: "$G다시 남자:다시 여자;" });
    const again = await apply("quests", { id: `${moment}:m`, text: "$G다시 남자:다시 여자;" });
    expect(again.text).toMatchObject({
      status: "unchanged",
      version: (first.text as { version: number }).version,
    });
    expect((again.text as { lines: string[] }).lines.sort()).toEqual([`${moment}:f`, `${moment}:m`]);
  });

  it("plain text to a side of an untranslated split is invalid and writes nothing", async () => {
    const moment = await splitMoment();
    const result = await apply("quests", { id: `${moment}:m`, text: "평문." });
    expect(result.text).toMatchObject({ status: "error", code: "invalid" });
    expect((result.text as { message: string }).message).toContain("$G");
    expect(await sections.quests.version(LANG, `${moment}:m`, 0)).toBeNull();
  });
});

describe("in English", () => {
  const english = () => ({ ...context, lang: "enUS" as const });

  it("quest text is invalid", async () => {
    const result = await apply("quests", { id: f.quest.lineId, variant: f.quest.variant, text: "Words." }, english());
    expect(result.text).toMatchObject({ status: "error", code: "invalid" });
  });

  it("a name is invalid", async () => {
    const result = await apply("bosses", { id: f.boss.lineId, name: "Words" }, english());
    expect(result.name).toMatchObject({ status: "error", code: "invalid" });
  });

  it("place text updates", async () => {
    const result = await apply("places", { id: f.zone, text: "Better English." }, english());
    expect(result.text).toMatchObject({ status: "updated", version: 2 });
    await asSystem.query(`delete from "lore_line" where "lineId" = $1 and "lang" = 'enUS' and "version" = 2`, [f.zone]);
    await asSystem.query(`update "lore_line" set "isCurrent" = true where "lineId" = $1 and "lang" = 'enUS'`, [f.zone]);
  });
});
