/**
 * loadDirtyContext() against a real Postgres: what it has to get right is that the sweep
 * sees one change per word however many times the word was saved, because the log grows with
 * every save and the sweep is paid per take per change.
 *
 * Every row is written under a language no site serves, and removed after each case.
 *
 * Needs DATABASE_URL and the migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Lang } from "@/lib/lang";

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { dirtyFiles, loadDirtyContext } = await import("./dirty");
const { forgetTeams } = await import("@/lib/teams/store");

const LANG = "xxXX" as Lang;

// A team for it, since a language nobody owns has nothing to read.
beforeAll(async () => {
  await asSystem.query(
    `insert into "team_language" ("teamId", "lang") select "id", $1 from "team" where "slug" = 'english'
     on conflict do nothing`,
    [LANG],
  );
  forgetTeams();
});

async function logged(grapheme: string, changedAt: string): Promise<void> {
  await asSystem.query(
    `insert into "lexicon_change" ("grapheme", "kind", "changedAt", "lang", "teamId")
     values ($1, 'edited', $2, $3, (select "teamId" from "team_language" where "lang" = $3 and "privileged"))`,
    [grapheme, changedAt, LANG],
  );
}

afterEach(async () => {
  await asSystem.query(`delete from "lexicon_change" where "lang" = $1`, [LANG]);
});

afterAll(async () => {
  await asSystem.query(`delete from "team_language" where "lang" = $1`, [LANG]);
  forgetTeams();
  await closeDb();
});

describe("loadDirtyContext", () => {
  it("keeps only the newest change of each word, newest first", async () => {
    await logged("Tauren", "2026-09-01T00:00:00Z");
    await logged("tauren", "2026-09-03T00:00:00Z");
    await logged("Tauren", "2026-09-02T00:00:00Z");
    await logged("Magatha", "2026-09-05T00:00:00Z");

    const { changes } = await loadDirtyContext("quests", LANG);

    expect(changes).toEqual([
      { grapheme: "Magatha", changedAt: Date.parse("2026-09-05T00:00:00Z") },
      { grapheme: "tauren", changedAt: Date.parse("2026-09-03T00:00:00Z") },
    ]);
  });

  it("marks the same takes the full log would", async () => {
    // The newest change is the only one that can be newer than a take the older ones are
    // newer than, so dropping the rest must never clear a mark.
    for (const day of ["01", "02", "03"]) await logged("Narache", `2026-09-${day}T00:00:00Z`);
    const takes = [
      { file: "before-all.mp3", text: "Narache waits.", generatedAt: Date.parse("2026-08-31T00:00:00Z") },
      { file: "between.mp3", text: "Narache waits.", generatedAt: Date.parse("2026-09-02T12:00:00Z") },
      { file: "after-all.mp3", text: "Narache waits.", generatedAt: Date.parse("2026-09-04T00:00:00Z") },
    ];

    const dirty = dirtyFiles(takes, await loadDirtyContext("quests", LANG));

    expect([...dirty].sort()).toEqual(["before-all.mp3", "between.mp3"]);
  });
});
