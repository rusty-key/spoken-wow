/** Needs DATABASE_URL and migrations through 0095; the session and GitHub are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { forgetReleaseCheck } from "@/lib/releases/sync";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, ownTeam, testUser, unowned } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "" }));

vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "member" } }),
}));

const github = vi.hoisted(() => ({ dispatchRelease: vi.fn(), findRun: vi.fn() }));
vi.mock("@/lib/releases/github", async (original) => ({
  ...(await original<typeof import("@/lib/releases/github")>()),
  ...github,
}));

const droplet = vi.hoisted(() => ({ startDropletRun: vi.fn() }));
vi.mock("@/lib/releases/droplet", async (original) => ({
  ...(await original<typeof import("@/lib/releases/droplet")>()),
  ...droplet,
}));

import { GET, POST } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let de: Awaited<ReturnType<typeof ownTeam>>;

const url = (lang: string) => `http://x/api/releases?lang=${lang}`;
const press = (lang: string, body: unknown) =>
  POST(new Request(url(lang), { method: "POST", body: JSON.stringify(body) }));
const read = (lang: string) => GET(new Request(url(lang)));

const makeAdmin = (lang: string, team: string) =>
  asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, $3, 'admin', $2)`,
    [team, user.id, lang],
  );
const dropAdmin = (lang: string) =>
  asSystem.query(`delete from "team_member" where "userId" = $1 and "lang" = $2`, [user.id, lang]);

beforeAll(async () => {
  user = await testUser("test-release-route");
  who.id = user.id;
  fr = await ownTeam("frFR");
  de = await ownTeam("deDE");
  // The caller administers French only.
  await makeAdmin("frFR", fr.team);
});

beforeEach(() => {
  forgetReleaseCheck();
  github.dispatchRelease.mockReset().mockResolvedValue(undefined);
  github.findRun.mockReset().mockResolvedValue(null);
  droplet.startDropletRun.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await asSystem.query(`delete from "release_run"`);
  await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
});

afterAll(async () => {
  await dropAdmin("frFR");
  await de.restore();
  await fr.restore();
  await user.cleanup();
  await closeDb();
});

describe("release route", () => {
  it("answers 403 to somebody who does not administer the language, on both verbs", async () => {
    // English is always visible, so the refusal is the capability's and not a switched-off language's 404.
    expect((await press(BASE_LANG, { section: "quests" })).status).toBe(403);
    expect((await read(BASE_LANG)).status).toBe(403);
    expect(github.dispatchRelease).not.toHaveBeenCalled();
  });

  it("answers 400 to a section outside the four", async () => {
    expect((await press("frFR", { section: "voices" })).status).toBe(400);
    expect((await press("frFR", {})).status).toBe(400);
    expect(github.dispatchRelease).not.toHaveBeenCalled();
  });

  it("answers 202 to a good press and dispatches once", async () => {
    const response = await press("frFR", { section: "quests" });
    expect(response.status).toBe(202);
    expect(github.dispatchRelease).toHaveBeenCalledTimes(1);
    const { run } = await response.json();
    expect(run).toMatchObject({ section: "quests", lang: "frFR", state: "dispatching" });
    expect(github.dispatchRelease.mock.calls[0][0]).toMatchObject({ id: run.id, section: "quests", lang: "frFR" });
  });

  it("starts a section the droplet can release there, and quests still on GitHub", async () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/shared/release.env");
    try {
      const bosses = await press("frFR", { section: "bosses" });
      expect(bosses.status).toBe(202);
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
      expect(github.dispatchRelease).not.toHaveBeenCalled();
      await asSystem.query(`delete from "release_run"`);

      expect((await press("frFR", { section: "quests" })).status).toBe(202);
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
      expect(github.dispatchRelease).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers 502 with the reason when the job cannot start, and frees the lock", async () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/shared/release.env");
    try {
      droplet.startDropletRun.mockRejectedValueOnce(new Error("spawn setsid ENOENT"));
      const failed = await press("frFR", { section: "bosses" });
      expect(failed.status).toBe(502);
      expect((await failed.json()).error).toBe("spawn setsid ENOENT");
      expect((await press("frFR", { section: "bosses" })).status).toBe(202);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers 409 naming the active run, and does not dispatch again", async () => {
    await press("frFR", { section: "quests" });
    const response = await press("frFR", { section: "places" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("quests in French");
    expect(github.dispatchRelease).toHaveBeenCalledTimes(1);
  });

  it("answers 502 with the reason when dispatch throws, and the next press works", async () => {
    github.dispatchRelease.mockRejectedValueOnce(new Error("GitHub answered 403: nope"));
    const failed = await press("frFR", { section: "quests" });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("GitHub answered 403: nope");
    const { recent } = await (await read("frFR")).json();
    expect(recent[0]).toMatchObject({ state: "failed", error: "GitHub answered 403: nope" });
    expect((await press("frFR", { section: "quests" })).status).toBe(202);
  });

  it("answers 400, and does not dispatch, for a language no team owns", async () => {
    const gone = await unowned("frFR");
    try {
      const response = await press("frFR", { section: "quests" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("no team");
      expect(github.dispatchRelease).not.toHaveBeenCalled();
    } finally {
      await gone.restore();
    }
  });

  it("shows another team's active run as section, language and state only", async () => {
    await makeAdmin("deDE", de.team);
    try {
      const german = await press("deDE", { section: "bosses" });
      expect(german.status).toBe(202);
      await asSystem.query(`update "release_run" set "githubUrl" = 'https://github.com/x/y/runs/1', "step" = 'Package audio', "error" = 'secret'`);

      const theirs = await (await read("frFR")).json();
      expect(theirs.active).toEqual({ section: "bosses", lang: "deDE", state: "dispatching", own: false });
      expect(JSON.stringify(theirs)).not.toContain(user.id);

      const own = await (await read("deDE")).json();
      expect(own.active).toMatchObject({ own: true, githubUrl: "https://github.com/x/y/runs/1", step: "Package audio" });
      expect(JSON.stringify(own)).not.toContain(user.id);
    } finally {
      await dropAdmin("deDE");
    }
  });

  it("treats a team's other language as its own team's run", async () => {
    const moved = await unowned("esES");
    await asSystem.query(`insert into "team_language" ("teamId", "lang") values ($1, 'esES')`, [fr.team]);
    forgetTeams();
    try {
      await makeAdmin("esES", fr.team);
      await press("frFR", { section: "quests" });
      expect((await (await read("esES")).json()).active).toMatchObject({ own: true, section: "quests", lang: "frFR" });
    } finally {
      await dropAdmin("esES");
      await asSystem.query(`delete from "team_language" where "teamId" = $1 and "lang" = 'esES'`, [fr.team]);
      await moved.restore();
    }
  });
});
