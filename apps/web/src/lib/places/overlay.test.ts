/** Needs DATABASE_URL and migrations through 0117 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";
import { createFixtures, type Fixtures } from "@/lib/text-api/testing";

import { baseCatalogue, catalogue, loadContext, type CatalogueEntry } from "./catalogue";
import { search } from "./search";

let fx: Fixtures;
let lang: Lang;
let a: string;
let b: string;
let english: string;
let u: { id: string; cleanup: () => Promise<void> };
let v: { id: string; cleanup: () => Promise<void> };

const OVERRIDE = "Our own words for this place.";

async function override(team: string, inLang: string, lineId: string, text: string): Promise<void> {
  await asSystem.query(
    `insert into "text_override" ("teamId", "lang", "source", "lineId", "text") values ($1, $2, 'places', $3, $4)`,
    [team, inLang, lineId, text],
  );
}

const entryOf = (entries: CatalogueEntry[], id: string) => entries.find((e) => e.id === id)!;

beforeEach(async () => {
  fx = await createFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  u = await testUser();
  v = await testUser();
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, v.id, lang, "regenerate");
  [{ id: english }] = await systemRows<{ id: string }>(`select "id" from "team" where "slug" = 'english'`);
  await asSystem.query(
    `insert into "lore_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key", "name", "full", "short")
     values ($1, $2, 1, true, 'edited', $3, 'zone', null, 'Testland', 'Translated lore.', 'Translated.')`,
    [fx.zone, lang, fx.map],
  );
  await override(b, lang, fx.zone, OVERRIDE);
});

afterEach(async () => {
  await asSystem.query(`delete from "text_override" where "lineId" in ($1, $2)`, [fx.zone, fx.subzone]);
  await asSystem.query(`delete from "take" where "lang" = $1`, [lang]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await v.cleanup();
  await fx.remove();
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("the places catalogue overlay", () => {
  it("is the base for a team with no overrides", async () => {
    const base = await baseCatalogue(lang);
    const mine = await asActor(v.id, () => catalogue(lang));
    expect(mine).toEqual(base);
    // Not a copy: a team with nothing to lay on top shares the base build.
    expect(mine).toBe(base);
  });

  it("speaks the acting team's override and keeps the original text", async () => {
    const base = entryOf(await baseCatalogue(lang), fx.zone);
    const entry = entryOf(await asActor(u.id, () => catalogue(lang)), fx.zone);
    expect(entry.spoken).toBe(OVERRIDE);
    expect(entry.hash).not.toBe(base.hash);
    expect(entry.full).toBe("Translated lore.");
    expect(entry.short).toBe(base.short);
    expect(entry.file).toBe(base.file);
    expect(entry.override?.text).toBe(OVERRIDE);
  });

  it("judges a take against the acting team's text", async () => {
    const base = entryOf(await baseCatalogue(lang), fx.zone);
    for (const team of [a, b]) {
      await asSystem.query(
        `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "spokenHash")
         values ($1, 'places', $2, $3, $4, 1, true, 'generated', 0, $5)`,
        [team, lang, base.file, fx.zone, base.hash],
      );
    }
    const stateAs = (user: string) =>
      asActor(user, async () => {
        const result = search(await catalogue(lang), await loadContext(lang), {}, 0, Number.MAX_SAFE_INTEGER);
        return result.lines.find((line) => line.id === fx.zone);
      });
    const second = await stateAs(u.id);
    expect(second?.state).toBe("stale");
    expect(second?.override?.text).toBe(OVERRIDE);
    const privileged = await stateAs(v.id);
    expect(privileged?.state).toBe("current");
    expect(privileged?.override).toBeNull();
  });

  it("does not carry English's overrides into a translation", async () => {
    // In the english team: enUS is the base language every translation is built over.
    await override(english, BASE_LANG, fx.zone, "An English override.");
    expect(entryOf(await catalogue(BASE_LANG), fx.zone).override?.text).toBe("An English override.");

    const base = entryOf(await baseCatalogue(lang), fx.zone);
    expect(base.override).toBeUndefined();
    const privileged = entryOf(await asActor(v.id, () => catalogue(lang)), fx.zone);
    expect(privileged.override).toBeUndefined();
    expect(privileged).toEqual(base);
    const second = entryOf(await asActor(u.id, () => catalogue(lang)), fx.zone);
    expect(second.spoken).toBe(OVERRIDE);
    expect(second.override?.text).toBe(OVERRIDE);
  });

  it("ignores an override on a line the language has not translated", async () => {
    await override(b, lang, fx.subzone, "Words with nothing under them.");
    const entry = entryOf(await asActor(u.id, () => catalogue(lang)), fx.subzone);
    expect(entry.missing?.text).toBe(true);
    expect(entry.spoken).toBe("");
    expect(entry.override).toBeUndefined();
  });

  it("keeps a second team's override from the privileged team", async () => {
    const base = entryOf(await baseCatalogue(lang), fx.zone);
    const entry = entryOf(await asActor(v.id, () => catalogue(lang)), fx.zone);
    expect(entry.spoken).toBe(base.spoken);
    expect(entry.hash).toBe(base.hash);
    expect(entry.override).toBeUndefined();
  });
});
