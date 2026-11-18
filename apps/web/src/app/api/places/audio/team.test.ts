/**
 * A places take as another team's: `?team=<slug>` plays that team's live take of the file, and
 * nothing of a file it has no live take of. No session: an anonymous visitor.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb } = await import("@/lib/db");
const { memoryBlobs, useArchiveForTests } = await import("@/lib/blobs/store");
const { baseCatalogue } = await import("@/lib/places/catalogue");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { createFixtures } = await import("@/lib/text-api/testing");
const { GET } = await import("./[...path]/route");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

let lang: Lang;
let otherLang: Lang;
let a: string;
let b: string;
let c: string;
let slugs: Map<string, string>;
let shared: { id: string; file: string };
let onlyA: { id: string; file: string };
let restore: () => void;
let fx: Awaited<ReturnType<typeof createFixtures>>;

async function take(team: string, line: { id: string; file: string }, sha: string) {
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "createdAt", "sha256", "archiveFile")
     values ($1, 'places', $2, $3, $4, 1, true, 'generated', 100, now(), $5, 'v1.mp3')`,
    [team, lang, line.file, line.id, sha],
  );
}

beforeEach(async () => {
  restore = useArchiveForTests(memoryBlobs(), "r2");
  fx = await createFixtures();
  lang = await uniqueLang();
  otherLang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-hear-a");
  b = await newTeamIn(lang, false, "test-hear-b");
  c = await newTeamIn(otherLang, true, "test-hear-c");
  const rows = await systemRows<{ id: string; slug: string }>(`select "id", "slug" from "team" where "id" = any($1)`, [
    [a, b, c],
  ]);
  slugs = new Map(rows.map((row) => [row.id, row.slug]));
  const entries = await baseCatalogue(lang);
  [shared, onlyA] = [fx.zone, fx.subzone].map((id) => {
    const entry = entries.find((e) => e.id === id)!;
    return { id: entry.id, file: entry.file };
  });
  await take(a, shared, SHA_A);
  await take(b, shared, SHA_B);
  await take(a, onlyA, SHA_A);
});

afterEach(async () => {
  restore();
  await asSystem.query(`delete from "take" where "teamId" = any($1)`, [[a, b, c]]);
  for (const team of [b, a, c]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(otherLang);
  await fx.remove();
  forgetTeams();
});

afterAll(closeDb);

function get(line: { file: string }, team?: string): Promise<Response> {
  const path = `${line.file}.mp3`;
  return GET(new Request(`https://example.com/api/places/audio/${path}?lang=${lang}${team ? `&team=${team}` : ""}`), {
    params: Promise.resolve({ path: path.split("/") }),
  });
}

describe("GET /api/places/audio?team=", () => {
  it("plays the named team's live take", async () => {
    const response = await get(shared, slugs.get(b));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://archive.test/takes/${SHA_B}`);
  });

  it("plays the acting team's without a team", async () => {
    const response = await get(shared);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://archive.test/takes/${SHA_A}`);
  });

  it("keeps the acting team's take out of shared caches and revalidates it, but not a named team's", async () => {
    expect((await get(shared)).headers.get("cache-control")).toBe("private, no-cache");
    expect((await get(shared, slugs.get(b))).headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");
  });

  it("is a bare 404 for a file the named team has no live take of", async () => {
    const response = await get(onlyA, slugs.get(b));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("no audio for this line");
  });

  it("answers an unknown slug, or a team of another language, with 404", async () => {
    for (const slug of ["nope", slugs.get(c)!]) {
      const response = await get(shared, slug);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: `no team ${slug} voices ${lang}` });
    }
  });
});
