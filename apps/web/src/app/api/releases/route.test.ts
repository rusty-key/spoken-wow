/** Needs DATABASE_URL and migrations through 0120; the session and GitHub are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { forgetReleaseCheck } from "@/lib/releases/sync";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, testUser, unowned } from "@/lib/teams/testing";

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

const encode = vi.hoisted(() => ({ encodeMissingForPack: vi.fn() }));
vi.mock("@/lib/takes/encode", () => encode);

import { GET, POST } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let de: Awaited<ReturnType<typeof ownTeam>>;

const url = (lang: string) => `http://x/api/releases?lang=${lang}`;
const press = (lang: string, body: unknown) =>
  POST(new Request(url(lang), { method: "POST", body: JSON.stringify(body) }));
const read = (lang: string) => GET(new Request(url(lang)));

const makeAdminFor = (userId: string, lang: string, team: string) =>
  asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, $3, 'admin', $2)`,
    [team, userId, lang],
  );
const makeAdmin = (lang: string, team: string) => makeAdminFor(user.id, lang, team);
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
  encode.encodeMissingForPack.mockReset().mockResolvedValue(undefined);
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
    // A take whose encoding failed at commit would stop the release it is about to start.
    expect(encode.encodeMissingForPack).toHaveBeenCalledWith("quests", "frFR", fr.team);
    expect(encode.encodeMissingForPack.mock.invocationCallOrder[0]).toBeLessThan(
      github.dispatchRelease.mock.invocationCallOrder[0],
    );
  });

  it("starts every section on the droplet once it can release there", async () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/shared/release.env");
    try {
      expect((await press("frFR", { section: "bosses" })).status).toBe(202);
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
      expect(droplet.startDropletRun.mock.calls[0][1]).toBe("patch");
      await asSystem.query(`delete from "release_run"`);

      expect((await press("frFR", { section: "quests" })).status).toBe(202);
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(2);
      expect(github.dispatchRelease).not.toHaveBeenCalled();
      await asSystem.query(`delete from "release_run"`);

      expect((await press("frFR", { section: "quests", bump: "major" })).status).toBe(202);
      expect(droplet.startDropletRun.mock.calls[2][1]).toBe("major");
      await asSystem.query(`delete from "release_run"`);

      expect((await press("frFR", { section: "quests", bump: "huge" })).status).toBe(400);
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(3);
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

  it("answers 502 without dispatching when encoding the missing takes throws, and frees the lock", async () => {
    encode.encodeMissingForPack.mockRejectedValueOnce(new Error("connection terminated"));
    const failed = await press("frFR", { section: "quests" });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("connection terminated");
    expect(github.dispatchRelease).not.toHaveBeenCalled();
    const { recent } = await (await read("frFR")).json();
    expect(recent[0]).toMatchObject({ state: "failed", error: "connection terminated" });
    expect((await press("frFR", { section: "quests" })).status).toBe(202);
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

      // A test user is named after its id, which would read as the id leaking.
      await asSystem.query(`update "user" set "name" = 'Release Tester' where "id" = $1`, [user.id]);
      const own = await (await read("deDE")).json();
      expect(own.active).toMatchObject({
        own: true,
        githubUrl: "https://github.com/x/y/runs/1",
        step: "Package audio",
        by: "Release Tester",
      });
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

  describe("a team that is not official, or not the language's privileged team", () => {
    const CLOSED = "Releases for your team are not open on this site yet; your takes stay on the site.";
    let team = "";
    let second: Awaited<ReturnType<typeof testUser>>;
    let before = "";

    beforeEach(async () => {
      team = await newTeamIn("frFR", false, "release-second");
      second = await testUser("test-release-second");
      await makeAdminFor(second.id, "frFR", team);
      before = who.id;
    });

    afterEach(async () => {
      who.id = before;
      vi.unstubAllEnvs();
      await asSystem.query(`update "team" set "official" = true where "id" = $1`, [fr.team]);
      await asSystem.query(`delete from "release_run" where "teamId" = $1`, [team]);
      await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
      await dropTeam(team);
      await second.cleanup();
      forgetTeams();
    });

    const pressAs = (userId: string) => {
      who.id = userId;
      return asActor(userId, () => press("frFR", { section: "places" }));
    };
    const runsOf = async (teamId: string) =>
      (await asSystem.query(`select "id" from "release_run" where "teamId" = $1`, [teamId])).rows;

    it("is refused with no run while team releases are closed, and the privileged admin still dispatches", async () => {
      const refused = await pressAs(second.id);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe(CLOSED);
      expect(await runsOf(team)).toEqual([]);
      expect(github.dispatchRelease).not.toHaveBeenCalled();

      who.id = before;
      expect((await press("frFR", { section: "places" })).status).toBe(202);
      expect(github.dispatchRelease).toHaveBeenCalledTimes(1);
    });

    it("refuses a privileged team a request made, which is not official", async () => {
      await asSystem.query(`update "team" set "official" = false where "id" = $1`, [fr.team]);
      const refused = await press("frFR", { section: "places" });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe(CLOSED);
      expect(await runsOf(fr.team)).toEqual([]);
    });

    it("presses under its own team where team releases are open, naming the team to the job", async () => {
      vi.stubEnv("SPOKEN_TEAM_RELEASES", "1");
      vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/shared/release.env");
      const response = await pressAs(second.id);
      expect(response.status).toBe(202);
      expect(await runsOf(team)).toHaveLength(1);
      const [{ slug }] = (await asSystem.query(`select "slug" from "team" where "id" = $1`, [team])).rows;
      expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
      expect(droplet.startDropletRun.mock.calls[0][0]).toMatchObject({ teamId: team, teamSlug: slug, section: "places" });
      // Its own takes, which the pack it builds sends, and not the privileged team's.
      expect(encode.encodeMissingForPack).toHaveBeenCalledWith("places", "frFR", team);
    });

    it("stays refused where team releases are open but the release would run on GitHub", async () => {
      vi.stubEnv("SPOKEN_TEAM_RELEASES", "1");
      vi.stubEnv("SPOKEN_RELEASE_ENV", "");
      const refused = await pressAs(second.id);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe(CLOSED);
      expect(await runsOf(team)).toEqual([]);
    });
  });
});
