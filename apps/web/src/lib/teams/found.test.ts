/** Needs DATABASE_URL and migrations through 0108 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_TEAMS, closeDb, inTransaction, withTeam } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";
import { isLang, langName } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew } from "@/lib/languages/store";

import { TeamError } from "./admin";
import { afterFounded, foundTeam, languageBranch, slugFor, type FoundInput, type Founded } from "./found";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, runningJob, systemRows, testUser } from "./testing";

let actor: Awaited<ReturnType<typeof testUser>>;
let requester: Awaited<ReturnType<typeof testUser>>;
let users: Awaited<ReturnType<typeof testUser>>[];
let codes: string[];
let teams: Set<string>;

/** `xq` and two random capitals, fresh per call so a run never meets another's leftovers. */
function code(): string {
  const capital = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  let made: string;
  do made = `xq${capital()}${capital()}`;
  while (codes.includes(made));
  codes.push(made);
  return made;
}

beforeEach(async () => {
  codes = [];
  teams = new Set();
  actor = await testUser("test-found-actor");
  requester = await testUser("test-found-requester");
  users = [actor, requester];
  forgetTeams();
});

afterEach(async () => {
  const held = await systemRows<{ teamId: string }>(
    `select "teamId" from "team_language" where "lang" = any($1::text[])`,
    [codes],
  );
  for (const { teamId } of held) teams.add(teamId);
  await asSystem.query(
    `delete from "activity" where "actorId" = $1 or "lang" = any($2::text[]) or "teamId" = any($3::uuid[])`,
    [actor.id, codes, [...teams]],
  );
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const team of teams) await dropTeam(team);
  for (const user of users) await user.cleanup();
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
});

afterAll(closeDb);

const refused = (status: number, message?: string) => (error: unknown) =>
  error instanceof TeamError && error.status === status && (!message || error.message.includes(message));

async function found(input: FoundInput): Promise<Founded> {
  const founded = await withTeam(ALL_TEAMS, (client) => foundTeam(client, input, actor.id));
  teams.add(founded.teamId);
  await afterFounded(founded, actor.id);
  return founded;
}

/** A known language as an admin adds one: a row, switched off, with a team of its own. */
async function known(lang: string, name = "Xq Old"): Promise<string> {
  await inTransaction((client) => addLanguage(client, describeNew(lang, name, name), actor.id));
  forgetLanguages();
  await loadLanguages();
  const [{ team }] = await systemRows<{ team: string }>(`select team_of_lang($1) as "team"`, [lang]);
  teams.add(team);
  return team;
}

async function teamOfLang(lang: string): Promise<string | null> {
  return (await systemRows<{ team: string | null }>(`select team_of_lang($1) as "team"`, [lang]))[0].team;
}

async function textByTeamOf(lang: string): Promise<boolean | undefined> {
  const rows = await systemRows<{ textByTeam: boolean }>(`select "textByTeam" from "language" where "code" = $1`, [lang]);
  return rows[0]?.textByTeam;
}

const input = (lang: string, over: Partial<FoundInput> = {}): FoundInput => ({
  lang,
  language: { name: "Xq New", native: "Xq Neu" },
  team: { slug: null, name: "Japan Crew" },
  adminId: requester.id,
  ...over,
});

describe("slugFor", () => {
  it("lowercases and dashes the name, and falls back to the code", () => {
    expect(slugFor("Japan Crew", "xqAB")).toBe("japan-crew");
    expect(slugFor("日本語チーム", "jaJP")).toBe("jajp");
    expect(slugFor("  Équipe 2!! ", "frFR")).toBe("quipe-2");
    expect(slugFor("2 Fast", "frFR")).toBe("frfr");
    expect(slugFor("a".repeat(60), "frFR")).toHaveLength(41);
  });
});

describe("foundTeam, new language", () => {
  it("creates the language switched on, its team named by the request, and grants the admin", async () => {
    const lang = code();
    const founded = await found(input(lang));
    expect(founded.branch).toBe("new-language");
    expect(founded.switchedOn).toBe(true);
    expect(founded.granted.sort()).toEqual(["admin", "text"]);

    const [row] = await systemRows<{ enabled: boolean; textByTeam: boolean; bcp47: string; provider: string }>(
      `select "enabled", "textByTeam", "bcp47", "provider" from "language" where "code" = $1`,
      [lang],
    );
    expect(row).toMatchObject({ enabled: true, textByTeam: true, bcp47: `xq-${lang.slice(2)}`, provider: "xq" });

    expect(await teamOfLang(lang)).toBe(founded.teamId);
    const [team] = await systemRows<{ slug: string; name: string }>(`select "slug", "name" from "team" where "id" = $1`, [
      founded.teamId,
    ]);
    expect(team).toEqual({ slug: slugFor("Japan Crew", lang), name: "Japan Crew" });
    expect(team.slug).toBe("japan-crew");

    const grants = await grantsOf(requester.id);
    expect(grants.filter((grant) => grant.lang === lang).map((grant) => grant.capability).sort()).toEqual(["admin", "text"]);
    expect(isLang(lang)).toBe(true);

    const log = await systemRows<{ kind: string; teamId: string | null }>(
      `select "kind", "teamId" from "activity" where "actorId" = $1 order by "kind"`,
      [actor.id],
    );
    expect(log.map((entry) => entry.kind)).toEqual([
      "grant.added",
      "grant.added",
      "language.added",
      "language.toggled",
      "team.created",
    ]);
    expect(log.filter((entry) => entry.kind !== "team.created").every((entry) => entry.teamId === founded.teamId)).toBe(true);
  });

  it("gives a second team of the same name the next free slug", async () => {
    const first = await found(input(code()));
    const second = await found(input(code()));
    expect(first.slug).toBe("japan-crew");
    expect(second.slug).toBe("japan-crew-2");
  });

  it("keeps the code's own slug when the name falls back to it", async () => {
    const lang = code();
    const founded = await found(input(lang, { team: { slug: null, name: "日本語チーム" } }));
    expect(founded.slug).toBe(lang.toLowerCase());
  });

  it("refuses a new code with no names", async () => {
    const lang = code();
    await expect(found(input(lang, { language: null }))).rejects.toSatisfy(refused(400));
    expect(await systemRows(`select 1 from "language" where "code" = $1`, [lang])).toHaveLength(0);
  });

  it("refuses a taken explicit slug and leaves no language behind", async () => {
    const first = await found(input(code()));
    const lang = code();
    await expect(found(input(lang, { team: { slug: first.slug, name: "Again" } }))).rejects.toSatisfy(refused(409));
    expect(await systemRows(`select 1 from "language" where "code" = $1`, [lang])).toHaveLength(0);
  });

  it("refuses English", async () => {
    await expect(found(input("enUS", { language: null }))).rejects.toSatisfy(refused(400));
  });
});

describe("foundTeam, hand-over", () => {
  it("moves an unmaintained language to the new team, members and all", async () => {
    const lang = code();
    const auto = await known(lang);
    const owner = await testUser("test-found-owner");
    users.push(owner);
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'admin')`,
      [auto, owner.id, lang],
    );

    expect(await languageBranch(lang)).toBe("hand-over");
    const founded = await found(input(lang));
    expect(founded.branch).toBe("hand-over");
    expect(founded.from).toBe(lang.toLowerCase());
    expect(founded.switchedOn).toBe(true);
    expect(await teamOfLang(lang)).toBe(founded.teamId);
    expect(await systemRows(`select 1 from "team_language" where "teamId" = $1`, [auto])).toHaveLength(0);
    expect(await systemRows(`select 1 from "team" where "id" = $1`, [auto])).toHaveLength(1);
    expect(await textByTeamOf(lang)).toBe(true);
    expect(
      await systemRows(`select 1 from "team_member" where "teamId" = $1 and "userId" = $2`, [founded.teamId, owner.id]),
    ).toHaveLength(1);

    const log = await systemRows<{ teamId: string | null }>(
      `select "teamId" from "activity" where "actorId" = $1 and "kind" = 'team.language_moved'`,
      [actor.id],
    );
    expect(log).toEqual([{ teamId: founded.teamId }]);
  });

  it("refuses while a job of the language runs, and leaves nothing behind", async () => {
    const lang = code();
    const auto = await known(lang);
    const job = await runningJob(lang, auto);
    try {
      await expect(found(input(lang, { team: { slug: `t-${lang.toLowerCase()}-new`, name: "x" } }))).rejects.toSatisfy(
        refused(409),
      );
    } finally {
      await job.cleanup();
    }
    expect(await teamOfLang(lang)).toBe(auto);
    expect(await systemRows(`select 1 from "team" where "slug" = $1`, [`t-${lang.toLowerCase()}-new`])).toHaveLength(0);
    expect(await textByTeamOf(lang)).toBe(false);
  });

  it("ignores the names a request gave for a code that is known by now", async () => {
    const lang = code();
    await known(lang, "Xq Old");
    const founded = await found(input(lang, { language: { name: "Renamed", native: "Renamed" } }));
    expect(founded.branch).toBe("hand-over");
    expect(langName(lang)).toBe("Xq Old");
  });
});

describe("foundTeam, second team", () => {
  it("refuses a language a non-owner member looks after", async () => {
    const lang = code();
    const auto = await known(lang);
    const member = await testUser("test-found-member");
    users.push(member);
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
      [auto, member.id, lang],
    );
    expect(await languageBranch(lang)).toBe("second-team");
    await expect(found(input(lang))).rejects.toSatisfy(refused(409, "needs a second team (plan 5)"));
    expect(await teamOfLang(lang)).toBe(auto);
  });

  it("refuses a language a non-owner text maintainer looks after", async () => {
    const lang = code();
    const auto = await known(lang);
    const maintainer = await testUser("test-found-text");
    users.push(maintainer);
    await asSystem.query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`,
      [maintainer.id, lang],
    );
    expect(await languageBranch(lang)).toBe("second-team");
    await expect(found(input(lang))).rejects.toSatisfy(refused(409, "needs a second team (plan 5)"));
    expect(await teamOfLang(lang)).toBe(auto);
  });
});
