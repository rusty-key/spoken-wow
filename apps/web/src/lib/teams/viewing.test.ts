/** Needs DATABASE_URL and migrations through 0118 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

const { closeDb, db } = await import("@/lib/db");
const { teamLivePath, teamLiveTakes } = await import("@/lib/takes/store");
const { asActor } = await import("./acting");
const { everyTeamOf, forgetTeams, plainTeamOf, sharedLangs } = await import("./store");
const { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } = await import("./testing");
const { teamLiveOverrides, teamsVoicing, teamView, viewedTeam } = await import("./viewing");

let lang: Lang;
let otherLang: Lang;
let a: string;
let b: string;
let c: string;
let d: string;
let slugs: Map<string, string>;
let user: { id: string; cleanup: () => Promise<void> };
let tag: string;

beforeEach(async () => {
  lang = await uniqueLang();
  otherLang = await uniqueLang();
  a = await newTeamIn(lang, true, "test-view-a");
  b = await newTeamIn(lang, false, "test-view-b");
  d = await newTeamIn(lang, false, "test-view-0d");
  c = await newTeamIn(otherLang, true, "test-view-c");
  const rows = await systemRows<{ id: string; slug: string }>(`select "id", "slug" from "team" where "id" = any($1)`, [
    [a, b, c, d],
  ]);
  slugs = new Map(rows.map((row) => [row.id, row.slug]));
  user = await testUser("test-view");
  await addMember(b, user.id, lang, "admin");
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of ["take", "text_override"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1)`, [[a, b, c, d]]);
  }
  await user.cleanup();
  for (const team of [b, d, a, c]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(otherLang);
  forgetTeams();
});

afterAll(closeDb);

describe("teamsVoicing", () => {
  it("lists the team with plain packs first, then the others by name, none marked", async () => {
    const teams = await teamsVoicing(lang);
    // "test-view-0d-…" sorts before "test-view-b-…", the reverse of the order they were made in.
    expect(teams.map((team) => team.id)).toEqual([a, d, b]);
    expect(teams[2]).toEqual({ id: b, slug: slugs.get(b), name: slugs.get(b) });
  });

  it("lists every team of a language none of whose teams has plain packs, by name", async () => {
    const bare = await uniqueLang();
    const y = await newTeamIn(bare, false, "test-view-y");
    const x = await newTeamIn(bare, false, "test-view-x");
    try {
      expect((await teamsVoicing(bare)).map((team) => team.id)).toEqual([x, y]);
      expect(await viewedTeam(bare, null)).toMatchObject({ team: x, own: false });
    } finally {
      await dropTeam(x);
      await dropTeam(y);
      await dropLang(bare);
    }
  });

  it("answers a single-team language from the memo alone", async () => {
    await sharedLangs();
    await plainTeamOf(otherLang);
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");

    expect(await teamsVoicing(otherLang)).toEqual([]);
    const viewed = await viewedTeam(otherLang, null);
    expect(viewed).toMatchObject({ team: await plainTeamOf(otherLang), own: true });
    expect(viewed?.slug).toBeTruthy();

    expect(queries).not.toHaveBeenCalled();
    expect(connects).not.toHaveBeenCalled();
  });
});

describe("viewedTeam in a single-team language", () => {
  it("takes the team's own slug, from the memo alone", async () => {
    const team = (await plainTeamOf(otherLang))!;
    const [row] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]);
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");

    expect(await viewedTeam(otherLang, row.slug)).toMatchObject({ team: team, slug: row.slug, own: true });
    expect(queries).not.toHaveBeenCalled();
    expect(connects).not.toHaveBeenCalled();
  });
});

describe("viewedTeam", () => {
  it("is the acting team when no slug is named", async () => {
    expect(await asActor(user.id, () => viewedTeam(lang, null))).toEqual({
      team: b, slug: slugs.get(b), name: slugs.get(b), own: true,
    });
  });

  it("is the first team, not one's own, for somebody in none of them", async () => {
    expect(await viewedTeam(lang, null)).toMatchObject({ team: a, own: false });
  });

  it("is the named team, not one's own", async () => {
    expect(await asActor(user.id, () => viewedTeam(lang, slugs.get(a)!))).toMatchObject({ team: a, own: false });
  });

  it("is null for a team of another language", async () => {
    expect(await viewedTeam(lang, slugs.get(c)!)).toBeNull();
    expect(await viewedTeam(lang, "no-such-team")).toBeNull();
  });
});

describe("teamView", () => {
  it("is no view at all in a single-team language, from the memo alone", async () => {
    const single = await uniqueLang();
    const team = await newTeamIn(single, true, "test-view-single");
    try {
      await sharedLangs();
      const pool = db();
      const queries = vi.spyOn(pool, "query");
      const connects = vi.spyOn(pool, "connect");

      expect(await teamView(single, "anything")).toEqual({ teams: [], viewed: null, home: null });
      expect(queries).not.toHaveBeenCalled();
      expect(connects).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      await dropTeam(team);
      await dropLang(single);
    }
  });

  it("is no view in a language nobody owns", async () => {
    const unowned = await uniqueLang();
    try {
      expect(await teamView(unowned, null)).toEqual({ teams: [], viewed: null, home: null });
    } finally {
      await dropLang(unowned);
    }
  });

  it("is the acting team without a slug, and the named one with", async () => {
    const own = await asActor(user.id, () => teamView(lang, null));
    expect(own.teams.map((team) => team.id)).toEqual([a, d, b]);
    expect(own.viewed).toMatchObject({ team: b, own: true });
    expect(own.home).toBe(slugs.get(b));

    const other = await asActor(user.id, () => teamView(lang, slugs.get(a)!));
    expect(other.viewed).toMatchObject({ team: a, slug: slugs.get(a), own: false });
    expect(other.home).toBe(slugs.get(b));
  });

  it("falls back to the default for a slug naming no team of the language", async () => {
    for (const slug of ["no-such-team", slugs.get(c)!]) {
      const view = await asActor(user.id, () => teamView(lang, slug));
      expect(view.viewed).toMatchObject({ team: b, own: true });
    }
    expect(await teamView(lang, "no-such-team")).toMatchObject({ viewed: { team: a, own: false }, home: slugs.get(a) });
  });
});

describe("everyTeamOf", () => {
  it("groups a language under every team of it", async () => {
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
      `insert into "text_override" ("teamId", "lang", "source", "lineId", "text", "spokenHash")
       values ($1, $2, 'places', $3, 'Their words', 'hash')`,
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
