/**
 * The places search as another team: `?team=<slug>` lists that team's live takes and the
 * overrides they speak, and nothing else of its rows. No session: an anonymous visitor.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb, db } = await import("@/lib/db");
const { baseCatalogue } = await import("@/lib/places/catalogue");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { createFixtures } = await import("@/lib/text-api/testing");
const { GET } = await import("./route");

let lang: Lang;
let otherLang: Lang;
let a: string;
let b: string;
let c: string;
let slugs: Map<string, string>;
let lines: { id: string; file: string }[];
let fx: Awaited<ReturnType<typeof createFixtures>>;

async function take(team: string, line: { id: string; file: string }, spokenHash: string) {
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "credits", "costUsd", "voice", "modelId", "spokenHash", "archiveFile", "sha256")
     values ($1, 'places', $2, $3, $4, 1, true, 'generated', 100, 42, 0.5, 'secret-voice', 'secret-model',
             $5, 'secret-archive.mp3', 'secret-sha')`,
    [team, lang, line.file, line.id, spokenHash],
  );
}

async function override(team: string, line: { id: string }, text: string, spokenHash: string) {
  await asSystem.query(
    `insert into "text_override" ("teamId", "lang", "source", "lineId", "text", "spokenHash")
     values ($1, $2, 'places', $3, $4, $5)`,
    [team, lang, line.id, text, spokenHash],
  );
}

beforeEach(async () => {
  fx = await createFixtures();
  // A third line under the fixtures' map, which their cleanup removes with the rest.
  await asSystem.query(
    `insert into "lore_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key", "name", "full", "short")
     values ($1, 'enUS', 1, true, 'scraped', $2, 'subzone', 'test-key-2', 'Test Dell', 'English lore.', 'English.')`,
    [`s:${fx.map}:test-key-2`, fx.map],
  );
  lang = await uniqueLang();
  otherLang = await uniqueLang();
  // Switched on, so an anonymous visitor may see it.
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-pick-a");
  b = await newTeamIn(lang, false, "test-pick-b");
  c = await newTeamIn(otherLang, true, "test-pick-c");
  const rows = await systemRows<{ id: string; slug: string }>(`select "id", "slug" from "team" where "id" = any($1)`, [
    [a, b, c],
  ]);
  slugs = new Map(rows.map((row) => [row.id, row.slug]));
  const entries = await baseCatalogue(lang);
  lines = [fx.zone, fx.subzone, `s:${fx.map}:test-key-2`].map((id) => {
    const entry = entries.find((e) => e.id === id)!;
    return { id: entry.id, file: entry.file };
  });

  await take(a, lines[0], "secret-hash");
  await override(b, lines[1], "B's words for line 2", "secret-spoken");
  await take(b, lines[1], "secret-spoken");
  await override(b, lines[2], "B's unfinished words for line 3", "secret-unspoken");
  await take(b, lines[2], "secret-hash");
});

afterEach(async () => {
  for (const table of ["take", "text_override"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1)`, [[a, b, c]]);
  }
  for (const team of [b, a, c]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(otherLang);
  await fx.remove();
  forgetTeams();
});

afterAll(closeDb);

type Line = {
  id: string;
  state: string;
  take: Record<string, unknown> | null;
  override: { text: string } | null;
  madeBy: unknown;
};

function get(extra: string): Promise<Response> {
  return GET(new Request(`https://example.com/api/places/search?lang=${lang}${extra}`));
}

async function line(index: number, team?: string): Promise<{ line: Line; raw: string }> {
  const response = await get(`&line=${encodeURIComponent(lines[index].id)}${team ? `&team=${team}` : ""}`);
  expect(response.status).toBe(200);
  const raw = await response.text();
  const body = JSON.parse(raw) as { lines: Line[] };
  expect(body.lines).toHaveLength(1);
  return { line: body.lines[0], raw };
}

describe("GET /api/places/search?team=", () => {
  it("lists the named team's live takes and the overrides they speak", async () => {
    const slug = slugs.get(b)!;
    const two = await line(1, slug);
    expect(two.line.state).toBe("current");
    expect(two.line.override?.text).toBe("B's words for line 2");
    expect(two.line.take).toMatchObject({ version: 1, credits: null, modelId: null, voiceId: null, takes: 1 });
    expect(two.line.madeBy).toBeNull();

    const one = await line(0, slug);
    expect(one.line.state).toBe("missing");
    expect(one.line.take).toBeNull();

    const three = await line(2, slug);
    expect(three.line.override).toBeNull();

    for (const { raw } of [one, two, three]) {
      for (const secret of ["archiveFile", "sha256", "secret-", "costUsd", "\"credits\":4"]) expect(raw).not.toContain(secret);
    }
  });

  it("lists the acting team's takes without a team, as it always has", async () => {
    expect((await line(0)).line.take).not.toBeNull();
    expect((await line(1)).line.take).toBeNull();
    expect((await line(2)).line.override).toBeNull();
  });

  it("answers an unknown slug, or a team of another language, with 404", async () => {
    for (const slug of ["nope", slugs.get(c)!]) {
      const response = await get(`&team=${slug}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: `no team ${slug} voices ${lang}` });
    }
  });

  it("adds no query when the team named is the one acting", async () => {
    await get(`&line=${encodeURIComponent(lines[0].id)}`);
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");
    const today = await get(`&line=${encodeURIComponent(lines[0].id)}`);
    const counted = [queries.mock.calls.length, connects.mock.calls.length];
    queries.mockClear();
    connects.mockClear();
    const named = await get(`&line=${encodeURIComponent(lines[0].id)}&team=${slugs.get(a)}`);
    expect([queries.mock.calls.length, connects.mock.calls.length]).toEqual(counted);
    expect(await named.text()).toBe(await today.text());
    vi.restoreAllMocks();
  });
});
