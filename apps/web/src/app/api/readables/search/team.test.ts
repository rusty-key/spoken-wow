/**
 * The readables search as another team: `?team=<slug>` plays its live takes. No session.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lang } from "@/lib/lang";

vi.mock("@/lib/session", () => ({ currentSession: async () => null }));

const { closeDb } = await import("@/lib/db");
const { baseCatalogue } = await import("@/lib/readables/catalogue");
const { forgetTeams } = await import("@/lib/teams/store");
const { asSystem, dropLang, dropTeam, newTeamIn, systemRows, uniqueLang } = await import("@/lib/teams/testing");
const { forgetLanguages, loadLanguages } = await import("@/lib/languages/catalogue");
const { createFixtures } = await import("@/lib/text-api/testing");
const { GET } = await import("./route");

let lang: Lang;
let a: string;
let b: string;
let slug: string;
let page: { id: string; file: string };
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeEach(async () => {
  fx = await createFixtures();
  lang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-pickr-a");
  b = await newTeamIn(lang, false, "test-pickr-b");
  [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [b]);
  const first = (await baseCatalogue(lang)).find((entry) => entry.id === fx.page.lineId)!;
  page = { id: first.id, file: first.file };
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                         "credits", "voice", "modelId", "spokenHash", "archiveFile", "sha256")
     values ($1, 'readables', $2, $3, $4, 1, true, 'generated', 100, 42, 'secret-voice', 'secret-model',
             'secret-hash', 'secret-archive.mp3', 'secret-sha')`,
    [b, lang, page.file, page.id],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "take" where "teamId" = any($1)`, [[a, b]]);
  for (const team of [b, a]) await dropTeam(team);
  await dropLang(lang);
  await fx.remove();
  forgetTeams();
});

afterAll(closeDb);

describe("GET /api/readables/search?team=", () => {
  it("shows the named team's live take as current, and nothing private", async () => {
    const response = await GET(
      new Request(`https://example.com/api/readables/search?lang=${lang}&line=${encodeURIComponent(page.id)}&team=${slug}`),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("secret-");
    const body = JSON.parse(raw) as { lines: { state: string; take: unknown }[] };
    expect(body.lines).toEqual([expect.objectContaining({ state: "current", take: expect.objectContaining({ version: 1 }) })]);
  });
});
