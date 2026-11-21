/** Needs DATABASE_URL and migrations through 0117 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createNarratedFixtures, type NarratedFixtures } from "@/lib/text-api/testing";
import { writeTextOverride } from "@/lib/text-overrides/store";

import { baseCatalogue, catalogue, lineByPath, loadContext, teamLineByPath, type BossEntry } from "./catalogue";
import { search } from "./search";

let fx: NarratedFixtures;
let lang: Lang;
let a: string;
let b: string;
let u: { id: string; cleanup: () => Promise<void> };
let v: { id: string; cleanup: () => Promise<void> };

const OVERRIDE = "Our own telling of this boss.";

const entryOf = (entries: BossEntry[]) => entries.find((e) => e.id === fx.boss.lineId)!;

async function storedHash(lineId: string): Promise<string | null> {
  const { rows } = await asSystem.query<{ spokenHash: string | null }>(
    `select "spokenHash" from "text_override" where "lang" = $1 and "lineId" = $2`,
    [lang, lineId],
  );
  return rows[0].spokenHash;
}

async function story(): Promise<void> {
  await asSystem.query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text")
     values ($1, $2, 1, true, 'edited', 'The translated story.')`,
    [fx.boss.id, lang],
  );
}

beforeEach(async () => {
  fx = await createNarratedFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  u = await testUser();
  v = await testUser();
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, v.id, lang, "regenerate");
  await asSystem.query(
    `insert into "text_override" ("teamId", "lang", "source", "lineId", "text") values ($1, $2, 'bosses', $3, $4)`,
    [b, lang, fx.boss.lineId, OVERRIDE],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "take" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await v.cleanup();
  await fx.remove();
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("the bosses catalogue overlay", () => {
  it("stores the hash it speaks an override with", async () => {
    await story();
    await asActor(u.id, () =>
      writeTextOverride({ source: "bosses", lang, lineId: fx.boss.lineId, text: "Written here.", original: "The translated story.", userId: u.id }),
    );
    const entry = entryOf(await asActor(u.id, () => catalogue(lang)));
    expect(entry.spoken).toBe("Written here.");
    expect(await storedHash(fx.boss.lineId)).toBe(entry.hash);
  });

  it("resolves a permalink in the acting team's catalogue, override and all", async () => {
    await story();
    await asActor(u.id, () =>
      writeTextOverride({ source: "bosses", lang, lineId: fx.boss.lineId, text: "Written here.", original: "The translated story.", userId: u.id }),
    );
    const [map, slug] = entryOf(await baseCatalogue(lang)).file.split("/");
    const entry = await asActor(u.id, () => teamLineByPath(Number(map), slug, lang));
    expect(entry?.override?.text).toBe("Written here.");
    expect(entry?.hash).toBe(await storedHash(fx.boss.lineId));
    expect((await asActor(u.id, () => lineByPath(Number(map), slug, lang)))?.override).toBeUndefined();
  });

  it("is the base for a team with no overrides", async () => {
    await story();
    const base = await baseCatalogue(lang);
    const mine = await asActor(v.id, () => catalogue(lang));
    expect(mine).toEqual(base);
    expect(mine).toBe(base);
  });

  it("speaks the acting team's override, and only the acting team's", async () => {
    await story();
    const base = entryOf(await baseCatalogue(lang));
    const second = entryOf(await asActor(u.id, () => catalogue(lang)));
    expect(second.spoken).toBe(OVERRIDE);
    expect(second.hash).not.toBe(base.hash);
    expect(second.text).toBe("The translated story.");
    expect(second.file).toBe(base.file);
    expect(second.override?.text).toBe(OVERRIDE);

    const privileged = entryOf(await asActor(v.id, () => catalogue(lang)));
    expect(privileged.spoken).toBe(base.spoken);
    expect(privileged.hash).toBe(base.hash);
    expect(privileged.override).toBeUndefined();
  });

  it("judges a take against the acting team's text", async () => {
    await story();
    const base = entryOf(await baseCatalogue(lang));
    for (const team of [a, b]) {
      await asSystem.query(
        `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "spokenHash")
         values ($1, 'bosses', $2, $3, $4, 1, true, 'generated', 0, $5)`,
        [team, lang, base.file, fx.boss.lineId, base.hash],
      );
    }
    const lineAs = (user: string) =>
      asActor(user, async () => {
        const result = search(await catalogue(lang), await loadContext(lang), {}, 0, Number.MAX_SAFE_INTEGER);
        return result.lines.find((line) => line.id === fx.boss.lineId);
      });
    const second = await lineAs(u.id);
    expect(second?.state).toBe("stale");
    expect(second?.override?.text).toBe(OVERRIDE);
    const privileged = await lineAs(v.id);
    expect(privileged?.state).toBe("current");
    expect(privileged?.override).toBeNull();
  });

  it("ignores an override on a boss with no story", async () => {
    const entry = entryOf(await asActor(u.id, () => catalogue(lang)));
    expect(entry.text).toBeNull();
    expect(entry.spoken).toBeNull();
    expect(entry.hash).toBeNull();
    expect(entry.override).toBeUndefined();
  });
});
