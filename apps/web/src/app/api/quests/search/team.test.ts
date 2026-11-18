/**
 * The quests search as another team: `?team=<slug>` marks that team's voiced files, from a
 * corpus built as that team, and shows the overrides its live takes speak. No session.
 *
 * Needs DATABASE_URL and migrations through 0115 applied.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb } = await import("@/lib/db");
const { audioRelPath } = await import("@/lib/audio");
const { corpus } = await import("@/lib/quests/catalogue");
const { asTeam } = await import("@/lib/teams/acting");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { GET } = await import("./route");

let lang: Lang;
let a: string;
let b: string;
let slugs: Map<string, string>;
/** Three lines of three different files, as team B's corpus names them. */
let picked: { lineId: string; file: string }[];

async function take(team: string, line: { lineId: string; file: string }) {
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "createdAt", "credits", "voice", "modelId", "archiveFile", "sha256")
     values ($1, 'quests', $2, $3, $4, 1, true, 'generated', 100, '2026-01-02T00:00:00Z', 42, 'secret-voice',
             'secret-model', 'secret-archive.mp3', 'secret-sha')`,
    [team, lang, line.file, line.lineId],
  );
}

async function override(team: string, line: { lineId: string; file: string }, text: string) {
  await asSystem.query(
    `insert into "line_override" ("teamId", "lang", "file", "lineId", "text", "updatedAt")
     values ($1, $2, $3, $4, $5, '2026-01-01T00:00:00Z')`,
    [team, lang, line.file, line.lineId, text],
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
  for (const line of lines) {
    const files = filesOf.get(line.lineId) ?? new Set();
    files.add(audioRelPath(line));
    filesOf.set(line.lineId, files);
  }
  picked = [];
  const used = new Set<string>();
  for (const [lineId, files] of filesOf) {
    const [file] = files;
    if (files.size !== 1 || used.has(file)) continue;
    used.add(file);
    picked.push({ lineId, file });
    if (picked.length === 3) break;
  }

  await take(b, picked[0]);
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

  it("answers an unknown slug with 404", async () => {
    const response = await GET(new NextRequest(`https://example.com/api/quests/search?lang=${lang}&team=nope`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `no team nope voices ${lang}` });
  });
});
