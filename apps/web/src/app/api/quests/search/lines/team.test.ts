/**
 * "Regenerate everything matching" as another team: `?team=<slug>` counts that team's voiced
 * files as voiced. No session. The language is given its own text for one line, since an
 * untranslated line is never a gap.
 *
 * Needs DATABASE_URL and migrations through 0118 applied.
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
let slug: string;
let line: { lineId: string; file: string };

beforeEach(async () => {
  lang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  forgetLanguages();
  await loadLanguages();
  a = await newTeamIn(lang, true, "test-pickl-a");
  b = await newTeamIn(lang, false, "test-pickl-b");
  [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [b]);

  // A quest line of plain words, spoken by one voiced speaker, so its id names one file.
  const lines = (await asTeam(lang, b, () => corpus(lang))).lines;
  const count = new Map<string, number>();
  for (const each of lines) count.set(each.lineId, (count.get(each.lineId) ?? 0) + 1);
  const found = lines.find(
    (each) => each.source === "accept" && each.voice && count.get(each.lineId) === 1 && /^[A-Za-z ,.!?']+$/.test(each.text),
  )!;
  await asSystem.query(
    `insert into "quest_line" ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
                               "questTitle", "playerGender", "fileName", "text", "originalText", "generatable")
     select "lineId", 0, $2, 1, true, 'community', "source", "questId", "questTitle", "playerGender", "fileName",
            "text", "originalText", true
       from "quest_line" where "lineId" = $1 and "lang" = 'enUS' and "variant" = 0 and "isCurrent"`,
    [found.lineId, lang],
  );
  const translated = (await asTeam(lang, b, () => corpus(lang))).lines.find((each) => each.lineId === found.lineId)!;
  line = { lineId: found.lineId, file: audioRelPath(translated) };
  await asSystem.query(
    `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes")
     values ($1, 'quests', $2, $3, $4, 1, true, 'generated', 100)`,
    [b, lang, line.file, line.lineId],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "take" where "teamId" = any($1)`, [[a, b]]);
  await asSystem.query(`delete from "quest_line" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "entity_name" where "lang" = $1`, [lang]);
  for (const team of [b, a]) await dropTeam(team);
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

async function matched(team?: string): Promise<number> {
  const url = `https://example.com/api/quests/search/lines?lang=${lang}&state=missing&line=${encodeURIComponent(line.lineId)}${team ? `&team=${team}` : ""}`;
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(200);
  return ((await response.json()) as { matched: number }).matched;
}

describe("GET /api/quests/search/lines?team=", () => {
  it("counts a file the named team has voiced as voiced", async () => {
    expect(await matched(slug)).toBe(0);
    expect(await matched()).toBe(1);
  });
});

describe("GET /api/quests/search/lines?nonarrator=1", () => {
  it("leaves out the lines the named team's roster gives the narrator, and only those", async () => {
    // B reads gameobjects with the narrator and items with an NPC voice of its own.
    await asSystem.query(
      `insert into "voice" ("teamId", "name", "race", "gender")
       values ($1, 'narrator-male', 'narrator', 'male'), ($1, 'test-bitem', 'item', 'male')
       on conflict do nothing`,
      [b],
    );
    await asSystem.query(
      `insert into "voice_assignment" ("teamId", "race", "voice") values ($1, 'gameobject', 'narrator-male'), ($1, 'item', 'test-bitem')
       on conflict ("teamId", "race", coalesce("gender", ''), coalesce("flavor", '')) do update set "voice" = excluded."voice"`,
      [b],
    );
    const matching = async (extra: string) => {
      const url = `https://example.com/api/quests/search/lines?lang=${lang}&team=${slug}&source=accept,progress,complete${extra}`;
      return ((await (await GET(new NextRequest(url))).json()) as { matched: number }).matched;
    };
    const asB = (await asTeam(lang, b, () => corpus(lang))).lines.filter((each) => each.source !== "gossip");
    const narrator = asB.filter((each) => each.voice === "narrator-male");
    const directionOnly = asB.filter(
      (each) => each.voice !== "narrator-male" && each.text.replace(/<[A-Z][^<>]*>/g, "").trim() === "",
    );

    expect(narrator.length).toBeGreaterThan(0);
    expect(narrator.every((each) => each.npcType === "gameobject")).toBe(true);
    expect(asB.some((each) => each.voice === "test-bitem")).toBe(true);
    expect(await matching("&nonarrator=1")).toBe((await matching("")) - narrator.length - directionOnly.length);
  });
});
