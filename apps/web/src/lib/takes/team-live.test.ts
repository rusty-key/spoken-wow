/**
 * team_live_takes and team_live_overrides (migration 0115): another team's live takes, and the
 * overrides they speak, read through `query` with no team set, which row-level security would
 * otherwise answer with nothing.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Lang } from "@/lib/lang";

const { closeDb, query } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, uniqueLang } = await import("@/lib/teams/testing");

const TAKE_COLUMNS = [
  "lineId", "file", "version", "spokenHash", "characters", "durationSec", "bytes", "createdAt", "archiveFile", "sha256",
];

let lang: Lang;
let otherLang: Lang;
let a: string;
let b: string;
let tag: string;

async function take(
  team: string,
  l: string,
  source: string,
  file: string,
  lineId: string,
  version: number,
  isCurrent: boolean,
  createdAt = "2026-01-02T00:00:00Z",
) {
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "createdAt", "credits", "costUsd", "voice", "modelId", "spokenHash", "archiveFile", "sha256")
     values ($1, $2, $3, $4, $5, $6, $7, 'generated', 100, $8, 42, 0.5, 'secret-voice', 'secret-model', 'hash',
             'archive/x', 'abc')`,
    [team, source, l, file, lineId, version, isCurrent, createdAt],
  );
}

beforeAll(async () => {
  const { rows } = await asSystem.query<{ bypasses: boolean }>(
    `select "rolsuper" or "rolbypassrls" as "bypasses" from "pg_roles" where "rolname" = current_user`,
  );
  if (rows[0]?.bypasses) throw new Error("team-live.test.ts must run as spoken_app: set DATABASE_ROLE=spoken_app");
});

beforeEach(async () => {
  lang = await uniqueLang();
  otherLang = await uniqueLang();
  a = await newTeamIn(lang, true, "test-live-a");
  b = await newTeamIn(lang, false, "test-live-b");
  tag = randomUUID().slice(0, 8);
});

afterEach(async () => {
  for (const table of ["take", "line_override", "text_override"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1)`, [[a, b]]);
  }
  await dropTeam(b);
  await dropTeam(a);
  await dropLang(lang);
  await dropLang(otherLang);
});

afterAll(closeDb);

describe("team_live_takes", () => {
  beforeEach(async () => {
    await take(b, lang, "places", `places/${tag}-1.mp3`, `p:${tag}-1`, 1, false);
    await take(b, lang, "places", `places/${tag}-1.mp3`, `p:${tag}-1`, 2, true);
    await take(a, lang, "places", `places/${tag}-2.mp3`, `p:${tag}-2`, 1, true);
  });

  it("returns a team's current take, with no team set", async () => {
    const rows = await query<{ file: string; version: number }>(
      `select * from team_live_takes($1, $2, 'places')`,
      [b, lang],
    );
    expect(rows.map((r) => [r.file, r.version])).toEqual([[`places/${tag}-1.mp3`, 2]]);
    // RLS really binds this connection: the same read of the table finds nothing.
    expect(await query(`select 1 from "take" where "teamId" = $1`, [b])).toEqual([]);
  });

  it("returns exactly the public columns", async () => {
    const rows = await query(`select * from team_live_takes($1, $2, 'places')`, [b, lang]);
    expect(Object.keys(rows[0])).toEqual(TAKE_COLUMNS);
  });

  it("answers nothing for a language the team does not voice", async () => {
    await take(b, otherLang, "places", `places/${tag}-3.mp3`, `p:${tag}-3`, 1, true);
    expect(await query(`select * from team_live_takes($1, $2, 'places')`, [b, otherLang])).toEqual([]);
  });

  it("narrows to one file when given", async () => {
    await take(b, lang, "places", `places/${tag}-4.mp3`, `p:${tag}-4`, 1, true);
    const rows = await query<{ file: string }>(`select * from team_live_takes($1, $2, 'places', $3)`, [
      b, lang, `places/${tag}-4.mp3`,
    ]);
    expect(rows.map((r) => r.file)).toEqual([`places/${tag}-4.mp3`]);
  });
});

describe("team_live_overrides", () => {
  async function textOverride(lineId: string, updatedAt: string) {
    await asSystem.query(
      `insert into "text_override" ("teamId", "lang", "source", "lineId", "text", "updatedAt")
       values ($1, $2, 'places', $3, $4, $5)`,
      [b, lang, lineId, `words of ${lineId}`, updatedAt],
    );
  }

  it("returns only overrides a live take was made from", async () => {
    await textOverride(`p:${tag}-spoken`, "2026-01-01T00:00:00Z");
    await take(b, lang, "places", `places/${tag}-spoken.mp3`, `p:${tag}-spoken`, 1, true, "2026-01-02T00:00:00Z");
    await textOverride(`p:${tag}-untaken`, "2026-01-01T00:00:00Z");
    await textOverride(`p:${tag}-newer`, "2026-01-03T00:00:00Z");
    await take(b, lang, "places", `places/${tag}-newer.mp3`, `p:${tag}-newer`, 1, true, "2026-01-02T00:00:00Z");

    const rows = await query(`select * from team_live_overrides($1, $2, 'places')`, [b, lang]);
    expect(rows).toEqual([{ key: `p:${tag}-spoken`, text: `words of p:${tag}-spoken` }]);
  });

  it("answers nothing for a language the team does not voice", async () => {
    await asSystem.query(
      `insert into "text_override" ("teamId", "lang", "source", "lineId", "text", "updatedAt")
       values ($1, $2, 'places', $3, 'x', '2026-01-01T00:00:00Z')`,
      [b, otherLang, `p:${tag}`],
    );
    await take(b, otherLang, "places", `places/${tag}.mp3`, `p:${tag}`, 1, true);
    expect(await query(`select * from team_live_overrides($1, $2, 'places')`, [b, otherLang])).toEqual([]);
  });

  it("returns a quest line's override whose live take is a voice file of it", async () => {
    const line = `gossip/${tag}line.mp3`;
    await asSystem.query(
      `insert into "line_override" ("teamId", "lang", "file", "lineId", "text", "updatedAt")
       values ($1, $2, $3, $4, 'their words', '2026-01-01T00:00:00Z')`,
      [b, lang, line, `g:${tag}`],
    );
    await take(b, lang, "quests", `gossip/${tag}line-orc-male.mp3`, `g:${tag}`, 1, true);
    // Another team's take of the same line speaks none of B's words.
    await asSystem.query(
      `insert into "line_override" ("teamId", "lang", "file", "lineId", "text", "updatedAt")
       values ($1, $2, $3, $4, 'unspoken', '2026-01-01T00:00:00Z')`,
      [b, lang, `gossip/${tag}other.mp3`, `g:${tag}o`],
    );
    await take(a, lang, "quests", `gossip/${tag}other.mp3`, `g:${tag}o`, 1, true);

    const rows = await query(`select * from team_live_overrides($1, $2, 'quests')`, [b, lang]);
    expect(rows).toEqual([{ key: line, text: "their words" }]);
  });

  async function lineOverride(file: string, text: string, updatedAt: string) {
    await asSystem.query(
      `insert into "line_override" ("teamId", "lang", "file", "lineId", "text", "updatedAt")
       values ($1, $2, $3, $4, $5, $6)`,
      [b, lang, file, `g:${file}`, text, updatedAt],
    );
  }

  it("leaves a quest override with no take, or only an older one, private", async () => {
    await lineOverride(`gossip/${tag}untaken.mp3`, "untaken", "2026-01-01T00:00:00Z");
    await lineOverride(`gossip/${tag}newer.mp3`, "newer", "2026-01-03T00:00:00Z");
    await take(b, lang, "quests", `gossip/${tag}newer.mp3`, `g:${tag}`, 1, true, "2026-01-02T00:00:00Z");
    await lineOverride(`gossip/${tag}voiced.mp3`, "voiced", "2026-01-03T00:00:00Z");
    await take(b, lang, "quests", `gossip/${tag}voiced-orc.mp3`, `g:${tag}v`, 1, true, "2026-01-02T00:00:00Z");

    expect(await query(`select * from team_live_overrides($1, $2, 'quests')`, [b, lang])).toEqual([]);
  });

  it("does not count a file with its own override as a voice of a shorter one", async () => {
    const stem = `gossip/${tag}stem`;
    await lineOverride(`${stem}.mp3`, "base", "2026-01-01T00:00:00Z");
    await lineOverride(`${stem}-w1.mp3`, "own", "2026-01-01T00:00:00Z");
    await take(b, lang, "quests", `${stem}-w1.mp3`, `g:${tag}w`, 1, true, "2026-01-02T00:00:00Z");

    const rows = await query(`select * from team_live_overrides($1, $2, 'quests')`, [b, lang]);
    expect(rows).toEqual([{ key: `${stem}-w1.mp3`, text: "own" }]);
  });

  it("gives a voice file the shortest stem's override", async () => {
    const stem = `gossip/${tag}stem`;
    await lineOverride(`${stem}.mp3`, "short", "2026-01-01T00:00:00Z");
    await lineOverride(`${stem}-a.mp3`, "long", "2026-01-01T00:00:00Z");
    await take(b, lang, "quests", `${stem}-a-b.mp3`, `g:${tag}ab`, 1, true, "2026-01-02T00:00:00Z");

    const rows = await query(`select * from team_live_overrides($1, $2, 'quests')`, [b, lang]);
    expect(rows).toEqual([{ key: `${stem}.mp3`, text: "short" }]);
  });
});
