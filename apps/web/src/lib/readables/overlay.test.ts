/** Needs DATABASE_URL and migrations through 0117 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createFixtures, type Fixtures } from "@/lib/text-api/testing";
import { writeTextOverride } from "@/lib/text-overrides/store";

import { baseCatalogue, catalogue, loadContext, type BookPage } from "./catalogue";
import { search } from "./search";
import { spokenHash } from "./tools";

let fx: Fixtures;
let lang: Lang;
let a: string;
let b: string;
let u: { id: string; cleanup: () => Promise<void> };
let v: { id: string; cleanup: () => Promise<void> };
/** A second page of the fixture's owned book, which is read without its title. */
let second: string;

const TITLE = "El Tomo de Prueba";
const OVERRIDE = "Our own words for this page.";

async function override(team: string, lineId: string, text: string): Promise<void> {
  await asSystem.query(
    `insert into "text_override" ("teamId", "lang", "source", "lineId", "text") values ($1, $2, 'readables', $3, $4)`,
    [team, lang, lineId, text],
  );
}

async function translate(lineId: string, text: string): Promise<void> {
  await asSystem.query(
    `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
     values ($1, $2, 1, true, 'edited', $3, $4)`,
    [lineId, lang, TITLE, text],
  );
}

const pageOf = (pages: BookPage[], id: string) => pages.find((p) => p.id === id)!;

async function storedHash(lineId: string): Promise<string | null> {
  const { rows } = await asSystem.query<{ spokenHash: string | null }>(
    `select "spokenHash" from "text_override" where "lang" = $1 and "lineId" = $2`,
    [lang, lineId],
  );
  return rows[0].spokenHash;
}

beforeEach(async () => {
  fx = await createFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  u = await testUser();
  v = await testUser();
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, v.id, lang, "regenerate");
  second = `b:${Math.floor(Math.random() * 1_000_000_000) + 3_000_000_000}`;
  await asSystem.query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 2)`, [
    second,
    fx.page.bookId,
  ]);
  // The owned page is titled by its owner's name in the language.
  await asSystem.query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ('item', $1, $2, 1, true, 'extracted', $3)`,
    [String(fx.page.ownerId), lang, TITLE],
  );
  await translate(fx.page.lineId, "Translated first page.");
  await translate(second, "Translated second page.");
  await override(b, fx.page.lineId, OVERRIDE);
});

afterEach(async () => {
  await asSystem.query(`delete from "text_override" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "book_line" where "lineId" = $1`, [second]);
  await asSystem.query(`delete from "book_page" where "lineId" = $1`, [second]);
  await asSystem.query(`delete from "book_line" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await v.cleanup();
  await fx.remove();
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("the readables catalogue overlay", () => {
  it("is the base for a team with no overrides", async () => {
    const base = await baseCatalogue(lang);
    const mine = await asActor(v.id, () => catalogue(lang));
    expect(mine).toEqual(base);
    expect(mine).toBe(base);
  });

  it("speaks the override on a first page after its title, and keeps the original text", async () => {
    const base = pageOf(await baseCatalogue(lang), fx.page.lineId);
    const page = pageOf(await asActor(u.id, () => catalogue(lang)), fx.page.lineId);
    expect(base.spoken.startsWith(TITLE)).toBe(true);
    expect(page.spoken.startsWith(TITLE)).toBe(true);
    expect(page.spoken.endsWith(OVERRIDE)).toBe(true);
    expect(page.hash).toBe(spokenHash(page.spoken));
    expect(page.hash).not.toBe(base.hash);
    expect(page.text).toBe("Translated first page.");
    expect(page.file).toBe(base.file);
    expect(page.generatable).toBe(true);
    expect(page.override?.text).toBe(OVERRIDE);
  });

  it("stores the hash it speaks an override with, a first page's title and all", async () => {
    await asActor(u.id, () =>
      writeTextOverride({ source: "readables", lang, lineId: fx.page.lineId, text: "Written here.", original: "Translated first page.", userId: u.id }),
    );
    const page = pageOf(await asActor(u.id, () => catalogue(lang)), fx.page.lineId);
    expect(page.spoken.startsWith(TITLE)).toBe(true);
    expect(page.spoken.endsWith("Written here.")).toBe(true);
    expect(await storedHash(fx.page.lineId)).toBe(page.hash);
  });

  it("speaks the override alone on a later page", async () => {
    await override(b, second, OVERRIDE);
    const base = pageOf(await baseCatalogue(lang), second);
    const page = pageOf(await asActor(u.id, () => catalogue(lang)), second);
    expect(base.spoken).toBe("Translated second page.");
    expect(page.spoken).toBe(OVERRIDE);
    expect(page.hash).toBe(spokenHash(OVERRIDE));
    expect(page.text).toBe("Translated second page.");
    expect(page.override?.text).toBe(OVERRIDE);
  });

  it("builds only the overridden pages anew", async () => {
    const base = await baseCatalogue(lang);
    const mine = await asActor(u.id, () => catalogue(lang));
    expect(mine).not.toBe(base);
    expect(mine.length).toBe(base.length);
    for (const [i, page] of mine.entries()) {
      if (page.id === fx.page.lineId) expect(page).not.toBe(base[i]);
      else expect(page).toBe(base[i]);
    }
  });

  it("leaves the base without the override once a team's overlay is built", async () => {
    await asActor(u.id, () => catalogue(lang));
    const base = pageOf(await baseCatalogue(lang), fx.page.lineId);
    expect(base.override).toBeUndefined();
    expect(base.spoken.endsWith("Translated first page.")).toBe(true);
  });

  it("keeps a second team's override from the privileged team", async () => {
    const base = pageOf(await baseCatalogue(lang), fx.page.lineId);
    const page = pageOf(await asActor(v.id, () => catalogue(lang)), fx.page.lineId);
    expect(page.spoken).toBe(base.spoken);
    expect(page.hash).toBe(base.hash);
    expect(page.override).toBeUndefined();
  });

  it("refuses an override that is only markup", async () => {
    await override(b, second, "<HTML><BODY><P></P></BODY></HTML>");
    const page = pageOf(await asActor(u.id, () => catalogue(lang)), second);
    expect(page.generatable).toBe(false);
    expect(page.skipReason).toBe("empty");
  });

  it("ignores an override on a page the language has not translated", async () => {
    await override(b, fx.ownerlessPage.lineId, "Words with nothing under them.");
    const page = pageOf(await asActor(u.id, () => catalogue(lang)), fx.ownerlessPage.lineId);
    expect(page.missing?.text).toBe(true);
    expect(page.spoken).toBe("");
    expect(page.generatable).toBe(false);
    expect(page.override).toBeUndefined();
  });

  it("carries the override into a search line, and null where there is none", async () => {
    const lineAs = (user: string) =>
      asActor(user, async () => {
        const result = search(await catalogue(lang), await loadContext(lang), {}, 0, Number.MAX_SAFE_INTEGER);
        return result.lines.find((line) => line.id === fx.page.lineId);
      });
    expect((await lineAs(u.id))?.override?.text).toBe(OVERRIDE);
    expect((await lineAs(v.id))?.override).toBeNull();
  });
});
