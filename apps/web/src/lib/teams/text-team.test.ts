/**
 * The language's original text is no team's: a text maintainer's edit, and what resolving a
 * contribution leaves, are filed under the team they work in, and a rejection's ignores are the
 * language's.
 *
 * Needs DATABASE_URL and migrations through 0113 applied.
 */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveContribution } from "@/lib/contributions/accept";
import { noteFor } from "@/lib/contributions/notes";
import { createContribution } from "@/lib/contributions/store";
import { closeDb } from "@/lib/db";
import { registerLanguages, registeredExtras, type Lang } from "@/lib/lang";
import { saveQuestText } from "@/lib/quests/text";

import { asActor } from "./acting";
import { forgetTeams } from "./store";
import { addMember, asSystem, dropTeam, newTeamIn, randomLang, systemRows, testUser } from "./testing";

let lang: Lang;
let tag: string;
let lineId: string;
let teamA: string;
let teamB: string;
let m: Awaited<ReturnType<typeof testUser>>;
let contributionIds: number[] = [];
const extras = registeredExtras();

/** A current line of the language, as an import or a contribution leaves it. */
async function line(origin: string, note: string | null = null): Promise<void> {
  await asSystem.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text",
        "originalText", "note")
     values ($1, 0, $2, 1, true, $3, 'accept', split_part($1, ':', 2)::int, $1, 'Salve.', 'Hello.', $4)`,
    [lineId, lang, origin, note],
  );
}

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = randomLang();
  // A contribution is only in a language the site has.
  registerLanguages([
    ...extras,
    { code: lang, name: `Test ${lang}`, native: `Test ${lang}`, bcp47: "xq-XQ", provider: "xq", client: true },
  ]);
  lineId = `q:${960_000_000 + randomInt(30_000_000)}:accept`;
  m = await testUser("test-text-team-m");
  teamA = await newTeamIn(lang, true, "text-a");
  teamB = await newTeamIn(lang, false, "text-b");
  await addMember(teamB, m.id, lang, "regenerate");
  await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [
    m.id, lang,
  ]);
});

afterEach(async () => {
  await asSystem.query(`delete from "quest_line" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "line_ignore" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "contribution" where "id" = any($1::int[])`, [contributionIds]);
  contributionIds = [];
  await asSystem.query(`delete from "language_grant" where "lang" = $1`, [lang]);
  for (const team of [teamA, teamB]) await dropTeam(team);
  await m.cleanup();
  registerLanguages(extras);
  forgetTeams();
});

afterAll(closeDb);

describe("a text maintainer in a team without plain packs", () => {
  it("files a quest text edit under their own team", async () => {
    await line("extracted");
    await asActor(m.id, () =>
      saveQuestText({ lineId, variant: 0, lang, text: "Salve, viandante.", editedBy: m.id }),
    );
    const acts = await systemRows(`select "teamId" from "activity" where "kind" = 'text.edited' and "lang" = $1`, [lang]);
    expect(acts).toEqual([{ teamId: teamB }]);
  });

  it("files a contribution's rejection under their own team, and leaves the language's ignore", async () => {
    const dedup = `text-team-${tag}`;
    await createContribution({
      source: "quests", key: lineId, locale: lang, build: "1.12.1/5875", text: "Hello.", meta: {},
      raw: `raw:${dedup}`, dedup, body: null, name: null, email: null, userId: null, ip: null,
    });
    const [{ id }] = await systemRows<{ id: number }>(`select "id" from "contribution" where "dedup" = $1`, [dedup]);
    contributionIds.push(id);
    await line("contributed", noteFor(id));

    const outcome = await asActor(m.id, () => resolveContribution(id, "rejected", m.id, undefined, true));
    expect(outcome).toMatchObject({ ok: true });

    const ignores = await systemRows(`select "teamId", "lang" from "line_ignore" where "lineId" = $1`, [lineId]);
    expect(ignores).toEqual([{ teamId: null, lang }]);
    const acts = await systemRows(
      `select "kind", "teamId" from "activity" where "lang" = $1 and "kind" in ('contribution.resolved', 'ignore.set')
        order by "kind"`,
      [lang],
    );
    expect(acts).toEqual([
      { kind: "contribution.resolved", teamId: teamB },
      { kind: "ignore.set", teamId: teamB },
    ]);
  });
});
