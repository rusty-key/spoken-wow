/** Needs DATABASE_URL and migrations through 0121. The job is never spawned, and no email is sent. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asTeam } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

const droplet = vi.hoisted(() => ({ startDropletRun: vi.fn() }));
vi.mock("./droplet", async (original) => ({ ...(await original<typeof import("./droplet")>()), ...droplet }));

const encode = vi.hoisted(() => ({ encodeMissingForPack: vi.fn() }));
vi.mock("@/lib/takes/encode", () => encode);

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (to: string, subject: string, text: string) => {
    mail.sent.push({ to, subject, text });
    return true;
  },
}));

import { approve, delistPack, liveTeamPacks, reject, ReviewError, waitingCount, waitingLines, waitingReviews } from "./review";
import { lastReleasedAt, startRun } from "./store";
import { forgetReleaseCheck, syncActive } from "./sync";

const STAGED = {
  version: "1.0.0",
  packs: { SpokenPlacesAudio_frFR_second: { rev: "20261118T000000Z", baseRev: null, manifestSha256: "m", lang: "frFR" } },
  languages: {},
};

let presser: Awaited<ReturnType<typeof testUser>>;
let owner: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let second = "";
let slug = "";
let shared = "";

beforeAll(async () => {
  presser = await testUser("release-review-presser");
  owner = await testUser("release-review-owner");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
  fr = await ownTeam("frFR");
  second = await newTeamIn("frFR", false, "second");
  [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [second]);
});

beforeEach(() => {
  shared = mkdtempSync(join(tmpdir(), "release-review-"));
  vi.stubEnv("SPOKEN_RELEASE_ENV", join(shared, "release.env"));
  forgetReleaseCheck();
  mail.sent.length = 0;
  droplet.startDropletRun.mockReset().mockResolvedValue(undefined);
  encode.encodeMissingForPack.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await asSystem.query(`delete from "release_run" where "promotes" is not null`);
  await asSystem.query(`delete from "release_run"`);
  await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "teamId" = $1`, [second]);
  await dropTeam(second);
  await fr.restore();
  await presser.cleanup();
  await owner.cleanup();
  forgetTeams();
  await closeDb();
});

/** A version of the second team's places, staged and waiting. */
async function waiting(section = "places"): Promise<string> {
  const [{ id }] = await systemRows<{ id: string }>(
    `insert into "release_run" ("teamId", "section", "lang", "state", "requestedBy", "stage", "staged", "version", "createdAt", "finishedAt")
     values ($1, $2, 'frFR', 'awaiting_review', $3, true, $4, '1.0.0', now() - interval '1 hour', now()) returning "id"`,
    [second, section, presser.id, JSON.stringify(STAGED)],
  );
  return id;
}

function exits(id: string, code: number, log: string) {
  const dir = join(shared, "release-runs", id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries({ log, heartbeat: "", exit: String(code) })) writeFileSync(join(dir, name), text);
}

const row = async (id: string) =>
  (await systemRows<{ state: string; version: string | null; error: string | null; reviewedBy: string | null; reviewNote: string | null }>(
    `select "state", "version", "error", "reviewedBy", "reviewNote" from "release_run" where "id" = $1`, [id],
  ))[0];

const presserMail = () => mail.sent.filter((m) => m.to === `${presser.id}@example.invalid`);

describe("approve", () => {
  it("queues a promotion of what was staged, whose success makes the version done for the team", async () => {
    const id = await waiting();
    const promote = await approve(id, owner.id);
    expect(promote).toMatchObject({ kind: "promote", promotes: id, staged: STAGED, teamId: second, section: "places", lang: "frFR" });
    expect(await row(id)).toMatchObject({ state: "awaiting_review", reviewedBy: owner.id });
    expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
    expect(droplet.startDropletRun.mock.calls[0][0]).toMatchObject({ id: promote.id, kind: "promote", teamSlug: slug });
    expect(encode.encodeMissingForPack).not.toHaveBeenCalled();
    const before = await asTeam("frFR", second, () => lastReleasedAt("frFR"));
    expect(before.has("places")).toBe(false);

    exits(promote.id, 0, "==> promoted 1.0.0: SpokenPlacesAudio_frFR_second\n");
    await syncActive();
    expect(await row(id)).toMatchObject({ state: "done", version: "1.0.0" });
    expect((await row(promote.id)).state).toBe("done");
    // Counted from the staged run's start, which is when its build read the takes.
    const after = await asTeam("frFR", second, () => lastReleasedAt("frFR"));
    expect(after.has("places")).toBe(true);
    expect(presserMail().map((m) => m.subject)).toEqual([expect.stringContaining("Approved")]);
  });

  it("waits its turn behind a running release", async () => {
    await startRun("bosses", "frFR", presser.id);
    const promote = await approve(await waiting(), owner.id);
    expect(promote.state).toBe("queued");
  });

  it("leaves the version waiting, with the reason, when the promotion fails", async () => {
    const id = await waiting();
    const promote = await approve(id, owner.id);
    exits(promote.id, 1, "error: SpokenPlacesAudio_frFR_second changed on the channel since it was staged: ask Second to release again\n");
    await syncActive();
    expect(await row(id)).toMatchObject({
      state: "awaiting_review",
      error: "Approving failed: SpokenPlacesAudio_frFR_second changed on the channel since it was staged: ask Second to release again",
    });
    expect(presserMail()).toEqual([]);
  });

  it("refuses a version that is not waiting, and one already approved", async () => {
    const id = await waiting();
    await asSystem.query(`update "release_run" set "state" = 'superseded' where "id" = $1`, [id]);
    await expect(approve(id, owner.id)).rejects.toMatchObject({ status: 409 });
    const again = await waiting("bosses");
    await approve(again, owner.id);
    await expect(approve(again, owner.id)).rejects.toMatchObject({ status: 409 });
    await expect(approve("00000000-0000-0000-0000-000000000000", owner.id)).rejects.toBeInstanceOf(ReviewError);
  });
});

describe("reject", () => {
  it("needs a reason", async () => {
    const id = await waiting();
    await expect(reject(id, owner.id, "  ")).rejects.toMatchObject({ status: 400 });
    expect((await row(id)).state).toBe("awaiting_review");
  });

  it("settles the version rejected with the reason, and tells whoever pressed it", async () => {
    const id = await waiting();
    await reject(id, owner.id, "Half the takes clip at the end.");
    expect(await row(id)).toMatchObject({ state: "rejected", reviewedBy: owner.id, reviewNote: "Half the takes clip at the end." });
    expect(presserMail()).toEqual([expect.objectContaining({ text: expect.stringContaining("Half the takes clip at the end.") })]);
    const activity = await systemRows<{ kind: string; teamId: string }>(`select "kind", "teamId" from "activity" where "kind" = 'release.rejected'`);
    expect(activity).toEqual([{ kind: "release.rejected", teamId: second }]);
  });
});

describe("the review page's lists", () => {
  const take = (team: string, file: string) =>
    asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('places', 'frFR', $1, $2, 1, true, 'generated', 1, $3)`,
      [file, `z:${file}`, team],
    );

  afterEach(async () => {
    await asSystem.query(`delete from "take" where "file" like 'review-test-%'`);
  });

  it("lists a waiting version with what it changes as its team counts it, not as the privileged team", async () => {
    await take(second, "review-test-ours-1");
    await take(second, "review-test-ours-2");
    await take(fr.team, "review-test-theirs");
    const id = await waiting();
    const waits = await waitingReviews();
    expect(waits).toHaveLength(1);
    expect(await waitingCount()).toBe(1);
    expect(waits[0]).toMatchObject({ id, team: { id: second, slug }, lang: "frFR", section: "places", version: "1.0.0", approving: false });
    expect(waits[0].pending).toMatchObject({ count: 2, changes: [], people: [{ id: null, count: 2 }] });
    // The lines come when the dialog opens.
    expect((await waitingLines(id))?.changes.map((c) => c.file).sort()).toEqual(["review-test-ours-1", "review-test-ours-2"]);
  });

  it("counts a waiting version from its team's last release that brought players up to date", async () => {
    await asSystem.query(
      `insert into "release_run" ("teamId", "section", "lang", "state", "createdAt", "finishedAt")
       values ($1, 'places', 'frFR', 'unchanged', now() - interval '2 hours', now() - interval '2 hours'),
              ($2, 'places', 'frFR', 'done', now() - interval '30 minutes', now() - interval '30 minutes')`,
      [second, fr.team],
    );
    const id = await waiting();
    const [{ since }] = await systemRows<{ since: Date }>(
      `select max("createdAt") as "since" from "release_run" where "teamId" = $1 and "state" = 'unchanged'`, [second],
    );
    expect((await waitingReviews())[0].pending.since).toBe(since.toISOString());
    expect((await waitingLines(id))?.since).toBe(since.toISOString());
  });

  it("lists a team's pack once approved, and not once delisted", async () => {
    const id = await waiting();
    exits((await approve(id, owner.id)).id, 0, "==> promoted 1.0.0: SpokenPlacesAudio_frFR_second\n");
    await syncActive();
    expect(await waitingCount()).toBe(0);
    expect(await liveTeamPacks()).toEqual([
      expect.objectContaining({ team: expect.objectContaining({ id: second }), lang: "frFR", section: "places", version: "1.0.0" }),
    ]);
    const delist = await delistPack(second, "frFR", "places", owner.id);
    exits(delist.id, 0, "==> delisted SpokenPlacesAudio_frFR_second\n");
    await syncActive();
    expect(await liveTeamPacks()).toEqual([]);
  });
});

describe("delistPack", () => {
  it("queues a delisting of the team's pack in the section and language", async () => {
    const run = await delistPack(second, "frFR", "quests", owner.id);
    expect(run).toMatchObject({ kind: "delist", teamId: second, section: "quests", lang: "frFR" });
    expect(droplet.startDropletRun.mock.calls[0][0]).toMatchObject({ kind: "delist", section: "quests", lang: "frFR", teamSlug: slug });
  });

  it("does not delist an official team's pack", async () => {
    await expect(delistPack(fr.team, "frFR", "places", owner.id)).rejects.toMatchObject({ status: 409 });
  });
});
