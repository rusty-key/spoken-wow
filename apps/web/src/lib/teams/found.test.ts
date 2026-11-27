/** Needs DATABASE_URL and migrations through 0113 applied. */
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALL_TEAMS, closeDb, inTransaction, withTeam } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";
import { isLang, langName } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew } from "@/lib/languages/store";

import { TeamError } from "./admin";
import { afterFounded, foundTeam, languageBranch, slugFor, type FoundInput, type Founded } from "./found";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, plainTeam, systemRows, testUser } from "./testing";

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
  for (const table of ["take", "recording", "line_override", "generation_setting_locale", "pronunciation_lexicon_locale"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1::uuid[])`, [[...teams]]);
  }
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
  const team = await plainTeam(lang);
  teams.add(team);
  return team;
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
  official: false,
  ...over,
});

describe("slugFor", () => {
  it("lowercases and dashes the name, and falls back to the code", () => {
    expect(slugFor("Japan Crew", "xqAB")).toBe("japan-crew");
    expect(slugFor("日本語チーム", "jaJP")).toBe("jajp");
    expect(slugFor("  Équipe 2!! ", "frFR")).toBe("quipe-2");
    expect(slugFor("2 Fast", "frFR")).toBe("frfr");
    expect(slugFor("a".repeat(60), "frFR")).toHaveLength(37);
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

    expect(await plainTeam(lang)).toBe(founded.teamId);
    const [team] = await systemRows<{ slug: string; name: string; ownStorage: boolean }>(
      `select "slug", "name", "ownStorage" from "team" where "id" = $1`,
      [founded.teamId],
    );
    expect(team).toEqual({ slug: slugFor("Japan Crew", lang), name: "Japan Crew", ownStorage: true });
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

  it("leaves room for the suffix a taken long slug gets", async () => {
    const name = `Long ${"x".repeat(50)}`;
    const first = await found(input(code(), { team: { slug: null, name } }));
    const second = await found(input(code(), { team: { slug: null, name } }));
    expect(first.slug).toHaveLength(37);
    expect(second.slug).toBe(`${first.slug}-2`);
    expect(second.slug).toMatch(/^[a-z][a-z0-9-]{1,40}$/);
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

  it("adds a team to English beside its first, which keeps the plain packs", async () => {
    const english = await plainTeam("enUS");
    const founded = await found(input("enUS", { language: null }));
    expect(founded).toMatchObject({ branch: "add-team", granted: ["admin"] });
    expect(
      await systemRows(`select "teamId", "packName" from "team_language" where "lang" = 'enUS' order by "packName"`),
    ).toEqual([
      { teamId: english, packName: "plain" },
      { teamId: founded.teamId, packName: "slug" },
    ]);
  });
});

describe("foundTeam, a known language", () => {
  const voices = (team: string) =>
    systemRows<{ name: string; race: string; gender: string }>(
      `select "name", "race", "gender" from "voice" where "teamId" = $1 order by 1, 2, 3`,
      [team],
    );

  async function englishVoices() {
    const [english] = await systemRows<{ id: string }>(`select "id" from "team" where "slug" = 'english'`);
    return voices(english.id);
  }

  it("adds a team beside the language's team, equal to it, with audio roles only", async () => {
    const lang = code();
    const a = await known(lang);
    expect(await languageBranch(lang)).toBe("add-team");
    const founded = await found(input(lang));
    expect(founded).toMatchObject({
      branch: "add-team",
      from: null,
      switchedOn: false,
      languageName: null,
      settings: "fresh",
      granted: ["admin"],
    });
    expect(founded.teamId).not.toBe(a);
    expect(
      await systemRows(`select "teamId", "packName" from "team_language" where "lang" = $1 order by "packName"`, [lang]),
    ).toEqual([
      { teamId: a, packName: "plain" },
      { teamId: founded.teamId, packName: "slug" },
    ]);
    expect(await textByTeamOf(lang)).toBe(false);
    expect(
      await systemRows(`select "teamId", "capability" from "team_member" where "userId" = $1 and "lang" = $2`, [
        requester.id,
        lang,
      ]),
    ).toEqual([{ teamId: founded.teamId, capability: "admin" }]);
    const english = await englishVoices();
    expect(english.length).toBeGreaterThan(0);
    expect(await voices(founded.teamId)).toEqual(english);
  });

  it("tells every worker the language has a new team", async () => {
    const lang = code();
    await known(lang);
    const listener = new Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    try {
      const heard: string[] = [];
      listener.on("notification", (message) => heard.push(message.payload ?? ""));
      await listener.query(`listen spoken_team_language`);
      await found(input(lang));
      await vi.waitFor(() => expect(heard).toContain(lang));
    } finally {
      await listener.end();
    }
  });

  it("starts from the first team's settings when asked to copy", async () => {
    const lang = code();
    const a = await known(lang);
    await asSystem.query(
      `insert into "generation_setting_locale" ("teamId", "lang", "modelId", "voiceSettings", "seedStrategy")
       values ($1, $2, 'eleven_v3', '{}', 'none')`,
      [a, lang],
    );
    const founded = await found(input(lang, { settings: "copy" }));
    expect(founded).toMatchObject({ settings: "copy", from: lang.toLowerCase() });
    expect(
      await systemRows(`select "modelId" from "generation_setting_locale" where "teamId" = $1 and "lang" = $2`, [
        founded.teamId,
        lang,
      ]),
    ).toEqual([{ modelId: "eleven_v3" }]);
    expect(await voices(founded.teamId)).toEqual(await voices(a));
  });

  it("starts a team joining English from its first team's model settings and lexicon when asked to copy", async () => {
    const english = await plainTeam("enUS");
    const founded = await found(input("enUS", { language: null, settings: "copy" }));
    const settings = (team: string) =>
      systemRows(`select "modelId", "voiceSettings" from "generation_setting" where "teamId" = $1`, [team]);
    const lexicon = (team: string) =>
      systemRows(`select "entries", "dictionaryId" from "pronunciation_lexicon" where "teamId" = $1`, [team]);
    expect(await settings(founded.teamId)).toEqual(await settings(english));
    const [copied] = await lexicon(founded.teamId);
    const [first] = await lexicon(english);
    expect(copied).toEqual({ entries: first.entries, dictionaryId: null });
  });

  it.each(["fresh", "copy"] as const)("gives a %s team none of the other team's audio", async (settings) => {
    const lang = code();
    const a = await known(lang);
    const file = `gossip/${lang}-second.mp3`;
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', $1, $2, 'g:second', 1, true, 'generated', 1, $3)`,
      [lang, file, a],
    );
    await asSystem.query(
      `insert into "line_override" ("teamId", "lang", "file", "lineId", "text") values ($1, $2, $3, 'q:1:accept', 'x')`,
      [a, lang, file],
    );
    const founded = await found(input(lang, { settings }));
    for (const table of ["take", "recording", "line_override"]) {
      expect(await systemRows(`select 1 from "${table}" where "teamId" = $1`, [founded.teamId])).toHaveLength(0);
    }
    expect(await systemRows(`select 1 from "take" where "teamId" = $1 and "lang" = $2`, [a, lang])).toHaveLength(1);
  });

  it("refuses a requester who already works on the language, and leaves no team behind", async () => {
    const lang = code();
    const a = await known(lang);
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
      [a, requester.id, lang],
    );
    const name = `Second ${lang}`;
    await expect(found(input(lang, { team: { slug: null, name } }))).rejects.toSatisfy(
      refused(
        409,
        `You already work on ${langName(lang)} in ${lang.toLowerCase()}; one person works in one team per language.`,
      ),
    );
    expect(await systemRows(`select 1 from "team" where "name" = $1`, [name])).toHaveLength(0);
    expect(await systemRows(`select 1 from "team_language" where "lang" = $1`, [lang])).toHaveLength(1);
  });

  it("files the new team's log under it, not under the other team", async () => {
    const lang = code();
    const a = await known(lang);
    const founded = await found(input(lang, { settings: "copy" }));
    const log = await systemRows<{ kind: string; teamId: string | null; lang: string | null; subject: string | null; detail: unknown }>(
      `select "kind", "teamId", "lang", "subject", "detail" from "activity" where "actorId" = $1 order by "kind"`,
      [actor.id],
    );
    expect(log.map((entry) => entry.kind)).toEqual(["grant.added", "team.created", "team.joined_language"]);
    expect(log.find((entry) => entry.kind === "team.joined_language")).toEqual({
      kind: "team.joined_language",
      teamId: founded.teamId,
      lang,
      subject: founded.slug,
      detail: { slug: founded.slug, from: lang.toLowerCase() },
    });
    expect(log.find((entry) => entry.kind === "team.created")).toMatchObject({ teamId: founded.teamId, lang });
    expect(await systemRows(`select 1 from "activity" where "teamId" = $1`, [a])).toHaveLength(0);
  });

  it("switches on a language with no team, and gives its first team the text, with packs named by its slug", async () => {
    const lang = code();
    await asSystem.query(
      `insert into "language" ("code", "enabled", "name", "native", "bcp47", "provider", "client")
       values ($1, false, 'Xq Bare', 'Xq Bare', $2, 'xq', false)`,
      [lang, `xq-${lang.slice(2)}`],
    );
    expect(await languageBranch(lang)).toBe("add-team");

    const founded = await found(input(lang));
    expect(founded).toMatchObject({ branch: "add-team", from: null, switchedOn: true, settings: null });
    expect(await textByTeamOf(lang)).toBe(true);
    expect(
      await systemRows<{ capability: string }>(
        `select "capability" from "team_member" where "userId" = $1 and "lang" = $2`,
        [requester.id, lang],
      ),
    ).toEqual([{ capability: "admin" }]);
    expect(await systemRows(`select 1 from "language_grant" where "userId" = $1 and "lang" = $2`, [requester.id, lang])).toHaveLength(1);
    expect(await systemRows(`select "teamId", "packName" from "team_language" where "lang" = $1`, [lang])).toEqual([
      { teamId: founded.teamId, packName: "slug" },
    ]);
    expect(await voices(founded.teamId)).toEqual(await englishVoices());
  });

  it("gives plain packs to a team slugged by the code that joins a language with none", async () => {
    const lang = code();
    await asSystem.query(
      `insert into "language" ("code", "enabled", "name", "native", "bcp47", "provider", "client")
       values ($1, false, 'Xq Bare', 'Xq Bare', $2, 'xq', false)`,
      [lang, `xq-${lang.slice(2)}`],
    );
    const founded = await found(input(lang, { team: { slug: lang.toLowerCase(), name: "Xq" } }));
    expect(await plainTeam(lang)).toBe(founded.teamId);
  });

  it("ignores the names a request gave for a code that is known by now", async () => {
    const lang = code();
    await known(lang, "Xq Old");
    const founded = await found(input(lang, { language: { name: "Renamed", native: "Renamed" } }));
    expect(founded.branch).toBe("add-team");
    expect(langName(lang)).toBe("Xq Old");
  });
});
