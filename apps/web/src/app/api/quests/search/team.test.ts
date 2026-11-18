/**
 * The quests search as another team: `?team=<slug>` marks that team's voiced files, from a
 * corpus built as that team, and shows the overrides its live takes speak. No session.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb } = await import("@/lib/db");
const { audioRelPath } = await import("@/lib/audio");
const { corpus } = await import("@/lib/quests/catalogue");
const { asTeam } = await import("@/lib/teams/acting");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { facets } = await import("@/lib/facets");
const { asViewed } = await import("@/lib/teams/viewing");
const { shapedText } = await import("@/lib/generation/files");
const { currentConfig } = await import("@/lib/generation/settings");
const { spokenHash } = await import("@/lib/generation/spoken-hash");
const { GET } = await import("./route");

let lang: Lang;
let a: string;
let b: string;
let slugs: Map<string, string>;
/** Three lines of three different files, as team B's corpus names them. */
let picked: { lineId: string; file: string; line: CorpusLine }[];

async function take(team: string, line: { lineId: string; file: string }, said: string | null = null) {
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "credits", "voice", "modelId", "spokenHash", "archiveFile", "sha256")
     values ($1, 'quests', $2, $3, $4, 1, true, 'generated', 100, 42, 'secret-voice', 'secret-model', $5,
             'secret-archive.mp3', 'secret-sha')`,
    [team, lang, line.file, line.lineId, said],
  );
}

/** What an ElevenLabs take of `line` speaking `text` carries, as regenerating hashes it. */
async function hashOf(line: CorpusLine, text: string): Promise<string> {
  return spokenHash(shapedText(text, lang, line, "elevenlabs", (await currentConfig(lang)).raceTags));
}

async function override(team: string, line: { lineId: string; file: string; line: CorpusLine }, text: string) {
  await asSystem.query(
    `insert into "line_override" ("teamId", "lang", "file", "lineId", "text", "spokenHashes")
     values ($1, $2, $3, $4, $5, $6)`,
    [team, lang, line.file, line.lineId, text, [await hashOf(line.line, text)]],
  );
}

beforeEach(async () => {
  lang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-pickq-a");
  b = await newTeamIn(lang, false, "test-pickq-b");
  const rows = await systemRows<{ id: string; slug: string }>(`select "id", "slug" from "team" where "id" = any($1)`, [
    [a, b],
  ]);
  slugs = new Map(rows.map((row) => [row.id, row.slug]));

  // Lines whose id names one file alone, so a search by id answers for that file.
  const lines = (await asTeam(lang, b, () => corpus(lang))).lines;
  const filesOf = new Map<string, Set<string>>();
  const lineOf = new Map<string, CorpusLine>();
  for (const line of lines) {
    const files = filesOf.get(line.lineId) ?? new Set();
    files.add(audioRelPath(line));
    filesOf.set(line.lineId, files);
    lineOf.set(audioRelPath(line), line);
  }
  picked = [];
  const used = new Set<string>();
  for (const [lineId, files] of filesOf) {
    const [file] = files;
    if (files.size !== 1 || used.has(file)) continue;
    used.add(file);
    picked.push({ lineId, file, line: lineOf.get(file)! });
    if (picked.length === 3) break;
  }

  await take(b, picked[0], await hashOf(picked[0].line, "B's words, spoken"));
  await override(b, picked[0], "B's words, spoken");
  await take(a, picked[1]);
  await override(b, picked[2], "B's words, unfinished");
});

afterEach(async () => {
  for (const table of ["take", "line_override"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1)`, [[a, b]]);
  }
  for (const team of [b, a]) await dropTeam(team);
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

type Row = { lineId: string; audioPath: string; hasAudio: boolean; override: string | null; madeBy: unknown; stale: boolean };

async function rows(line: { lineId: string }, team?: string): Promise<{ rows: Row[]; raw: string }> {
  const url = `https://example.com/api/quests/search?lang=${lang}&line=${encodeURIComponent(line.lineId)}${team ? `&team=${team}` : ""}`;
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(200);
  const raw = await response.text();
  const body = JSON.parse(raw) as { lines: Row[] };
  expect(body.lines.length).toBeGreaterThan(0);
  return { rows: body.lines, raw };
}

describe("GET /api/quests/search?team=", () => {
  it("marks the named team's voiced file, with the override its take speaks", async () => {
    const slug = slugs.get(b)!;
    const voiced = await rows(picked[0], slug);
    expect(voiced.rows.map((row) => [row.hasAudio, row.override, row.madeBy, row.stale])).toEqual(
      voiced.rows.map(() => [true, "B's words, spoken", null, false]),
    );

    const theirs = await rows(picked[1], slug);
    expect(theirs.rows.every((row) => !row.hasAudio)).toBe(true);

    const unfinished = await rows(picked[2], slug);
    expect(unfinished.rows.every((row) => row.override === null && !row.hasAudio)).toBe(true);

    for (const { raw } of [voiced, theirs, unfinished]) {
      for (const secret of ["archiveFile", "sha256", "secret-"]) expect(raw).not.toContain(secret);
    }
  });

  it("marks the acting team's files without a team", async () => {
    expect((await rows(picked[1])).rows.every((row) => row.hasAudio)).toBe(true);
    expect((await rows(picked[0])).rows.every((row) => !row.hasAudio && row.override === null)).toBe(true);
  });

  it("shows a visitor outside the language only the acting team's overrides a live take speaks", async () => {
    await asSystem.query(`update "take" set "spokenHash" = $1 where "teamId" = $2 and "file" = $3`, [
      await hashOf(picked[1].line, "A's words, spoken"), a, picked[1].file,
    ]);
    await override(a, picked[1], "A's words, spoken");
    await override(a, picked[2], "A's words, unfinished");

    expect((await rows(picked[1])).rows.every((row) => row.override === "A's words, spoken")).toBe(true);
    const unfinished = await rows(picked[2]);
    expect(unfinished.rows.every((row) => row.override === null)).toBe(true);
    expect(unfinished.raw).not.toContain("unfinished");
  });

  it("reads the voice filter as the named team, whose roster names the voice", async () => {
    // B alone reads orc male guards with a voice of its own.
    await asSystem.query(`insert into "voice" ("teamId", "name", "race", "gender") values ($1, 'test-bvoice', 'orc', 'male')`, [b]);
    await asSystem.query(
      `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice") values ($1, 'orc', 'male', 'guard', 'test-bvoice')
       on conflict ("teamId", "race", coalesce("gender", ''), coalesce("flavor", '')) do update set "voice" = excluded."voice"`,
      [b],
    );
    const viewed = { team: b, slug: slugs.get(b)!, name: slugs.get(b)!, own: false };
    expect((await asViewed(lang, viewed, () => facets(lang))).voices).toContain("test-bvoice");
    expect((await asViewed(lang, null, () => facets(lang))).voices).not.toContain("test-bvoice");

    const url = `https://example.com/api/quests/search?lang=${lang}&team=${slugs.get(b)}&voice=test-bvoice&limit=500`;
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total: number; lines: { voice: string }[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.lines.every((line) => line.voice === "test-bvoice")).toBe(true);
  });

  it("answers an unknown slug with 404", async () => {
    const response = await GET(new NextRequest(`https://example.com/api/quests/search?lang=${lang}&team=nope`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `no team nope voices ${lang}` });
  });
});
