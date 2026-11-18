/**
 * Needs DATABASE_URL and migrations through 0120. Only the email and the session are mocked.
 *
 * A team a site owner makes is official; one a request makes is not, whichever branch approval
 * takes (TEAM-RELEASES.md, *Official teams*).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: () => {} }));
const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "admin" } }),
}));

import { POST } from "@/app/api/teams/route";
import { inTransaction } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew } from "@/lib/languages/store";

import { createTeam } from "./admin";
import { approveRequest, createRequest } from "./requests";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, randomLang, systemRows, testUser } from "./testing";

let requester: Awaited<ReturnType<typeof testUser>>;
let admin: Awaited<ReturnType<typeof testUser>>;
let member: Awaited<ReturnType<typeof testUser>>;
let codes: string[];
let teams: string[];

const code = () => {
  const made = randomLang();
  codes.push(made);
  return made;
};
const officialOf = async (team: string) =>
  (await systemRows<{ official: boolean }>(`select "official" from "team" where "id" = $1`, [team]))[0].official;

/** A known language; with a member who is no site owner, somebody looks after it. */
async function known(maintained: boolean): Promise<string> {
  const lang = code();
  await inTransaction((client) => addLanguage(client, describeNew(lang, "Xq Old", "Xq Old"), admin.id));
  forgetLanguages();
  await loadLanguages();
  // A hand-over leaves this team holding nothing, so the language's rows no longer find it.
  const [{ team }] = await systemRows<{ team: string }>(`select team_of_lang($1) as "team"`, [lang]);
  teams.push(team);
  if (maintained) {
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability")
       values (team_of_lang($1), $2, $1, 'regenerate')`,
      [lang, member.id],
    );
  }
  return lang;
}

async function approved(lang: string, language: { name: string; native: string } | null): Promise<string> {
  const request = await createRequest(requester.id, { lang, language, teamName: "Xq Team", note: null });
  const done = await approveRequest(request.id, admin.id);
  return done.approvedTeamId!;
}

beforeEach(async () => {
  codes = [];
  teams = [];
  requester = await testUser("test-official-req");
  admin = await testUser("test-official-admin");
  member = await testUser("test-official-member");
  who.id = admin.id;
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [admin.id]);
  forgetTeams();
});

afterEach(async () => {
  const held = await systemRows<{ teamId: string }>(`select "teamId" from "team_language" where "lang" = any($1::text[])`, [codes]);
  const users = [requester.id, admin.id, member.id];
  await asSystem.query(`delete from "activity" where "actorId" = any($1::text[]) or "lang" = any($2::text[])`, [users, codes]);
  await asSystem.query(`delete from "team_request" where "userId" = any($1::text[])`, [users]);
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const table of ["generation_setting_locale", "pronunciation_lexicon_locale"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1::uuid[])`, [held.map((row) => row.teamId)]);
  }
  for (const team of new Set([...held.map((row) => row.teamId), ...teams])) await dropTeam(team);
  for (const user of [requester, admin, member]) await user.cleanup();
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
});

describe("official", () => {
  it("is set on a team a site owner creates", async () => {
    const { id } = await createTeam({ slug: `official-${code().toLowerCase()}`, name: "Made", adminEmail: null }, admin.id);
    teams.push(id);
    expect(await officialOf(id)).toBe(true);
  });

  it("is set on a team a site owner founds with a new language", async () => {
    const lang = code();
    const response = await POST(
      new Request("http://x/api/teams", {
        method: "POST",
        body: JSON.stringify({ slug: `found-${lang.toLowerCase()}`, name: "Founded", newLanguage: { code: lang, name: "Xq", native: "Xq" } }),
      }),
    );
    expect(response.status).toBe(200);
    const { team } = (await response.json()) as { team: { id: string } };
    expect(await officialOf(team.id)).toBe(true);
  });

  it("is not set on a team a request makes for a new code", async () => {
    expect(await officialOf(await approved(code(), { name: "Xq New", native: "Xq New" }))).toBe(false);
  });

  it("is not set on a team a request makes for a language nobody looks after", async () => {
    expect(await officialOf(await approved(await known(false), null))).toBe(false);
  });

  it("is not set on a second team a request makes beside a maintained language", async () => {
    expect(await officialOf(await approved(await known(true), null))).toBe(false);
  });
});
