/**
 * The bosses search as another team: `?team=<slug>` plays its live takes. No session. The
 * language is given a story for one boss, since a boss with none reads stale whatever plays.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb } = await import("@/lib/db");
const { baseCatalogue } = await import("@/lib/bosses/catalogue");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { GET } = await import("./route");

let lang: Lang;
let a: string;
let b: string;
let slug: string;
let boss: { id: string; file: string };

beforeEach(async () => {
  lang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-pickb-a");
  b = await newTeamIn(lang, false, "test-pickb-b");
  [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [b]);
  const [first] = await baseCatalogue(lang);
  boss = { id: first.id, file: first.file };
  await asSystem.query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text") values ($1, $2, 1, true, 'rewritten', 'A story.')`,
    [first.bossId, lang],
  );
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "credits", "voice", "modelId", "spokenHash", "archiveFile", "sha256")
     values ($1, 'bosses', $2, $3, $4, 1, true, 'generated', 100, 42, 'secret-voice', 'secret-model',
             'secret-hash', 'secret-archive.mp3', 'secret-sha')`,
    [b, lang, boss.file, boss.id],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "take" where "teamId" = any($1)`, [[a, b]]);
  await asSystem.query(`delete from "boss_line" where "lang" = $1`, [lang]);
  for (const team of [b, a]) await dropTeam(team);
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("GET /api/bosses/search?team=", () => {
  it("shows the named team's live take as current, and nothing private", async () => {
    const response = await GET(
      new Request(`https://example.com/api/bosses/search?lang=${lang}&line=${encodeURIComponent(boss.id)}&team=${slug}`),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("secret-");
    const body = JSON.parse(raw) as { lines: { state: string; take: unknown }[] };
    expect(body.lines).toEqual([expect.objectContaining({ state: "current", take: expect.objectContaining({ version: 1 }) })]);
  });
});
