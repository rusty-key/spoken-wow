/** Needs DATABASE_URL and migrations through 0115 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

const { closeDb, db } = await import("@/lib/db");
const { teamLivePath, teamLiveTakes } = await import("@/lib/takes/store");
const { asActor } = await import("./acting");
const { everyTeamOf, forgetTeams, privilegedOf, secondTeamLangs } = await import("./store");
const { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } = await import("./testing");
const { teamLiveOverrides, teamsVoicing, viewedTeam } = await import("./viewing");

let lang: Lang;
let otherLang: Lang;
let a: string;
let b: string;
let c: string;
let slugs: Map<string, string>;
let user: { id: string; cleanup: () => Promise<void> };
let tag: string;

beforeEach(async () => {
  lang = await uniqueLang();
  otherLang = await uniqueLang();
  a = await newTeamIn(lang, true, "test-view-a");
  b = await newTeamIn(lang, false, "test-view-b");
  c = await newTeamIn(otherLang, true, "test-view-c");
  const rows = await systemRows<{ id: string; slug: string }>(`select "id", "slug" from "team" where "id" = any($1)`, [
    [a, b, c],
  ]);
  slugs = new Map(rows.map((row) => [row.id, row.slug]));
  user = await testUser("test-view");
  await addMember(b, user.id, lang, "admin");
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of ["take", "text_override"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1)`, [[a, b, c]]);
  }
  await user.cleanup();
  for (const team of [b, a, c]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(otherLang);
  forgetTeams();
});

afterAll(closeDb);

describe("teamsVoicing", () => {
  it("lists the privileged team first, then the second", async () => {
    const teams = await teamsVoicing(lang);
    expect(teams.map((team) => [team.id, team.privileged])).toEqual([
      [a, true],
      [b, false],
    ]);
    expect(teams[1].slug).toBe(slugs.get(b));
    expect(teams[1].name).toBe(slugs.get(b));
  });

  it("answers a single-team language from the memo alone", async () => {
    await secondTeamLangs();
    await privilegedOf("deDE");
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");

    expect(await teamsVoicing("deDE")).toEqual([]);
    const viewed = await viewedTeam("deDE", null);
    expect(viewed).toMatchObject({ team: await privilegedOf("deDE"), own: true });
    expect(viewed?.slug).toBeTruthy();

    expect(queries).not.toHaveBeenCalled();
    expect(connects).not.toHaveBeenCalled();
  });
});

describe("viewedTeam", () => {
  it("is the acting team when no slug is named", async () => {
    expect(await asActor(user.id, () => viewedTeam(lang, null))).toEqual({
      team: b, slug: slugs.get(b), name: slugs.get(b), own: true,
    });
    expect(await viewedTeam(lang, null)).toMatchObject({ team: a, own: true });
  });

  it("is the named team, not one's own", async () => {
    expect(await asActor(user.id, () => viewedTeam(lang, slugs.get(a)!))).toMatchObject({ team: a, own: false });
  });

  it("is null for a team of another language", async () => {
    expect(await viewedTeam(lang, slugs.get(c)!)).toBeNull();
    expect(await viewedTeam(lang, "no-such-team")).toBeNull();
  });
});

describe("everyTeamOf", () => {
  it("groups a language under its privileged team and every second team", async () => {
    const grouped = await everyTeamOf([lang, otherLang]);
    expect(grouped.get(a)).toEqual([lang]);
    expect(grouped.get(b)).toEqual([lang]);
    expect(grouped.get(c)).toEqual([otherLang]);
  });
});

describe("another team's live takes", () => {
  beforeEach(async () => {
    await asSystem.query(
      `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                           "createdAt", "credits", "durationSec", "spokenHash", "archiveFile", "sha256")
       values ($1, 'places', $2, $3, $4, 1, true, 'generated', 100, '2026-01-02T00:00:00Z', 42, 1.5, 'hash',
               'archive/x.mp3', null)`,
      [b, lang, `places/${tag}.mp3`, `p:${tag}`],
    );
    await asSystem.query(
      `insert into "text_override" ("teamId", "lang", "source", "lineId", "text", "updatedAt")
       values ($1, $2, 'places', $3, 'Their words', '2026-01-01T00:00:00Z')`,
      [b, lang, `p:${tag}`],
    );
  });

  it("reads the team's takes, without what they cost or where they are kept", async () => {
    const takes = await teamLiveTakes(b, "places", lang);
    expect(takes).toEqual([
      {
        lineId: `p:${tag}`,
        file: `places/${tag}.mp3`,
        version: 1,
        spokenHash: "hash",
        characters: null,
        durationSec: 1.5,
        bytes: 100,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    expect(takes[0]).not.toHaveProperty("credits");
    expect(await teamLiveTakes(a, "places", lang)).toEqual([]);
  });

  it("finds a live take's bytes, and none for a file the team has not voiced", async () => {
    expect(await teamLivePath(b, "places", `places/${tag}.mp3`, lang)).toMatchObject({ kind: "file" });
    expect(await teamLivePath(a, "places", `places/${tag}.mp3`, lang)).toEqual({ kind: "none" });
  });

  it("reads the override the take speaks", async () => {
    expect(await teamLiveOverrides(b, "places", lang)).toEqual(new Map([[`p:${tag}`, "Their words"]]));
  });
});
