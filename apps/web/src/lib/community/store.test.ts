/**
 * The community pack store against a real Postgres: submitting, reviewing and listing packs, and
 * the activity rows and email each act leaves.
 *
 * Needs DATABASE_URL and migrations through 0106 applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, systemRows, testUser } from "@/lib/teams/testing";

import {
  createPack,
  decide,
  historyByPack,
  listAll,
  listOwned,
  managerEntries,
  PackError,
  pendingCount,
  queueOf,
  setListed,
  setOwner,
  submitVersion,
  withdrawPending,
} from "./store";

type User = Awaited<ReturnType<typeof testUser>>;
let author: User;
let stranger: User;
let admin: User;
let helper: User;

const PREFIX = `test-pack-${randomUUID().slice(0, 6)}`;
let counter = 0;
const nextId = () => `${PREFIX}-${++counter}`;

const SHA = (c: string) => c.repeat(64);
const fields = (id: string, version: string, c = "a") => ({
  title: `Title of ${id}`,
  author: "Somebody",
  description: "A pack for tests.",
  version,
  size: 1234,
  sha256: SHA(c),
  url: `https://github.com/someone/${id}/releases/download/v${version}/${id}-${version}.zip`,
  homepage: "https://github.com/someone/repo",
  license: null,
});
const newPack = (id: string, version = "1.0.0") => ({ ...fields(id, version), id, lang: "deDE", section: "quests" });

const refused = (status: number) => (error: unknown) => error instanceof PackError && error.status === status;

let info: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  // Email goes to the console, as in development without a Resend account.
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  author = await testUser("test-pack-author");
  stranger = await testUser("test-pack-stranger");
  admin = await testUser("test-pack-admin");
  helper = await testUser("test-pack-helper");
  await asSystem.query(`update "user" set "role" = 'pack_author' where "id" = any($1)`, [[author.id, stranger.id, helper.id]]);
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [admin.id]);
});

beforeEach(() => {
  info?.mockRestore();
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterAll(async () => {
  info?.mockRestore();
  await asSystem.query(`delete from "activity" where "kind" like 'pack.%' and "subject" like $1`, [`${PREFIX}-%`]);
  await asSystem.query(`delete from "community_pack" where "id" like $1`, [`${PREFIX}-%`]);
  for (const user of [author, stranger, admin, helper]) await user?.cleanup();
  await closeDb();
});

/** Recipients of the emails logged since the last beforeEach. */
function emailed(subject: string): string[] {
  return info.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => line.includes(subject))
    .map((line: string) => /to (\S+?):/.exec(line)?.[1] ?? "");
}

const emailOf = (user: User) => `${user.id}@example.invalid`;
const today = () => new Date().toISOString().slice(0, 10);

async function approved(id: string, version = "1.0.0") {
  const pack = await createPack(author.id, newPack(id, version));
  await decide(admin.id, pack.pending!.id, "approve");
  return pack;
}

describe("a new pack", () => {
  it("goes from pending to approved and into the Manager's list", async () => {
    const id = nextId();
    const pack = await createPack(author.id, newPack(id));
    expect(pack).toMatchObject({ id, ownerId: author.id, ownerName: author.id, listed: true, live: null });
    expect(pack.pending).toMatchObject({ status: "pending", version: "1.0.0", submittedBy: author.id });
    expect((await managerEntries()).map((e) => e.id)).not.toContain(id);
    expect(queueOf(await listAll()).map((s) => s.packId)).toContain(id);
    expect(await pendingCount()).toBeGreaterThanOrEqual(1);

    const decided = await decide(admin.id, pack.pending!.id, "approve");
    expect(decided).toMatchObject({ status: "approved", reviewedBy: admin.id });

    const entry = (await managerEntries()).find((e) => e.id === id);
    expect(entry).toEqual({
      id,
      title: `Title of ${id}`,
      author: "Somebody",
      description: "A pack for tests.",
      lang: "deDE",
      section: "quests",
      version: "1.0.0",
      size: 1234,
      sha256: SHA("a"),
      url: fields(id, "1.0.0").url,
      homepage: "https://github.com/someone/repo",
      addedAt: today(),
    });
    expect((await listOwned(author.id)).find((p) => p.id === id)).toMatchObject({ live: { version: "1.0.0" }, pending: null });
  });

  it("refuses an id already taken", async () => {
    const id = nextId();
    await createPack(author.id, newPack(id));
    await expect(createPack(stranger.id, newPack(id))).rejects.toSatisfy(refused(409));
  });

  it("refuses a submission breaking the rules, with the field's error", async () => {
    const error = await createPack(author.id, { ...newPack(nextId()), sha256: "nope" }).catch((e) => e);
    expect(error).toBeInstanceOf(PackError);
    expect(error.status).toBe(400);
    expect(error.errors).toHaveProperty("sha256");
  });

  it("refuses somebody who may not submit packs", async () => {
    const member = await testUser("test-pack-member");
    try {
      await expect(createPack(member.id, newPack(nextId()))).rejects.toSatisfy(refused(403));
    } finally {
      await member.cleanup();
    }
  });
});

describe("a new version", () => {
  it("waits behind a pending one", async () => {
    const id = nextId();
    await createPack(author.id, newPack(id));
    await expect(submitVersion(author.id, id, fields(id, "1.1.0", "b"))).rejects.toSatisfy(refused(409));
  });

  it("must be newer than the live one", async () => {
    const id = nextId();
    await approved(id, "1.0.0");
    await expect(submitVersion(author.id, id, fields(id, "1.0.0", "b"))).rejects.toSatisfy(refused(400));
    await expect(submitVersion(author.id, id, fields(id, "0.9.0", "b"))).rejects.toSatisfy(refused(400));
  });

  it("must point at a new zip", async () => {
    const id = nextId();
    await approved(id, "1.0.0");
    const sameUrl = { ...fields(id, "1.1.0", "b"), url: fields(id, "1.0.0").url };
    await expect(submitVersion(author.id, id, sameUrl)).rejects.toSatisfy(refused(400));
    await expect(submitVersion(author.id, id, fields(id, "1.1.0", "a"))).rejects.toSatisfy(refused(400));
  });

  it("is refused to a stranger without naming the pack", async () => {
    const id = nextId();
    await approved(id);
    const error = await submitVersion(stranger.id, id, fields(id, "2.0.0", "b")).catch((e) => e);
    expect(error).toBeInstanceOf(PackError);
    expect(error.status).toBe(403);
    expect(error.message).not.toContain(`Title of ${id}`);
    expect(error.message).not.toContain(id);
  });

  it("is accepted from an admin on somebody else's pack", async () => {
    const id = nextId();
    await approved(id);
    await expect(submitVersion(admin.id, id, fields(id, "1.1.0", "b"))).resolves.toMatchObject({ status: "pending" });
  });

  it("is refused for an unknown pack", async () => {
    await expect(submitVersion(author.id, `${PREFIX}-missing`, fields("x", "1.0.0"))).rejects.toSatisfy(refused(404));
  });

  it("after a rejection leaves the approved version in the Manager's list", async () => {
    const id = nextId();
    await approved(id, "1.0.0");
    const next = await submitVersion(author.id, id, fields(id, "1.1.0", "b"));
    await decide(admin.id, next.id, "reject", "The zip does not open.");

    const entry = (await managerEntries()).find((e) => e.id === id);
    expect(entry).toMatchObject({ version: "1.0.0", sha256: SHA("a") });
    const pack = (await listOwned(author.id)).find((p) => p.id === id)!;
    expect(pack.live?.version).toBe("1.0.0");
    expect(pack.lastRejected).toMatchObject({ version: "1.1.0", rejectReason: "The zip does not open." });
    expect((await historyByPack()).get(id)!.map((s) => s.status)).toEqual(["rejected", "approved"]);
  });
});

describe("an unlisted pack", () => {
  it("takes no submissions and leaves the Manager's list", async () => {
    const id = nextId();
    await approved(id);
    const pack = await setListed(admin.id, id, false);
    expect(pack.listed).toBe(false);
    expect((await managerEntries()).map((e) => e.id)).not.toContain(id);
    await expect(submitVersion(author.id, id, fields(id, "2.0.0", "b"))).rejects.toSatisfy(refused(404));

    await setListed(admin.id, id, true);
    expect((await managerEntries()).map((e) => e.id)).toContain(id);
  });

  it("can only be unlisted by an admin", async () => {
    const id = nextId();
    await approved(id);
    await expect(setListed(author.id, id, false)).rejects.toSatisfy(refused(403));
  });
});

describe("deciding", () => {
  it("lets one of two admins deciding at once win, and tells the other", async () => {
    const id = nextId();
    const pack = await createPack(author.id, newPack(id));
    const results = await Promise.allSettled([
      decide(admin.id, pack.pending!.id, "approve"),
      decide(admin.id, pack.pending!.id, "reject", "Too late."),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(refused(409)((rejected[0] as PromiseRejectedResult).reason)).toBe(true);
    const [row] = await systemRows(`select "status" from "community_pack_submission" where "id" = $1`, [pack.pending!.id]);
    expect(row.status).toBe((fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value.status);
  });

  it("needs a reason to reject", async () => {
    const pack = await createPack(author.id, newPack(nextId()));
    await expect(decide(admin.id, pack.pending!.id, "reject")).rejects.toSatisfy(refused(400));
    await expect(decide(admin.id, pack.pending!.id, "reject", "   ")).rejects.toSatisfy(refused(400));
    await expect(decide(admin.id, pack.pending!.id, "reject", "x".repeat(501))).rejects.toSatisfy(refused(400));
  });

  it("is for admins only", async () => {
    const pack = await createPack(author.id, newPack(nextId()));
    await expect(decide(author.id, pack.pending!.id, "approve")).rejects.toSatisfy(refused(403));
  });
});

describe("withdrawing", () => {
  it("frees the slot for another submission", async () => {
    const id = nextId();
    await createPack(author.id, newPack(id));
    await withdrawPending(author.id, id);
    await expect(withdrawPending(author.id, id)).rejects.toSatisfy(refused(404));
    await expect(submitVersion(author.id, id, fields(id, "1.0.1", "b"))).resolves.toMatchObject({ status: "pending" });
  });

  it("is not for strangers", async () => {
    const id = nextId();
    await createPack(author.id, newPack(id));
    await expect(withdrawPending(stranger.id, id)).rejects.toSatisfy(refused(403));
  });
});

describe("an owner whose account is deleted", () => {
  it("leaves the pack live and lets an admin hand it on", async () => {
    const leaving = await testUser("test-pack-leaving");
    await asSystem.query(`update "user" set "role" = 'pack_author' where "id" = $1`, [leaving.id]);
    const id = nextId();
    const pack = await createPack(leaving.id, newPack(id));
    await decide(admin.id, pack.pending!.id, "approve");
    await leaving.cleanup();

    expect((await managerEntries()).map((e) => e.id)).toContain(id);
    const orphan = (await listAll()).find((p) => p.id === id)!;
    expect(orphan).toMatchObject({ ownerId: null, ownerName: null, live: { version: "1.0.0", submittedBy: null } });

    expect(await setOwner(admin.id, id, helper.id)).toMatchObject({ ownerId: helper.id, ownerName: helper.id });
    await expect(submitVersion(helper.id, id, fields(id, "1.1.0", "b"))).resolves.toMatchObject({ status: "pending" });
    expect(await setOwner(admin.id, id, null)).toMatchObject({ ownerId: null });
  });

  it("can only be reassigned by an admin, to an account that exists", async () => {
    const id = nextId();
    await createPack(author.id, newPack(id));
    await expect(setOwner(author.id, id, stranger.id)).rejects.toSatisfy(refused(403));
    await expect(setOwner(admin.id, id, "no-such-user")).rejects.toSatisfy(refused(404));
    await expect(setOwner(admin.id, `${PREFIX}-missing`, null)).rejects.toSatisfy(refused(404));
  });
});

describe("the activity log", () => {
  it("has a row for each act", async () => {
    const id = nextId();
    const pack = await createPack(author.id, newPack(id));
    await withdrawPending(author.id, id);
    const second = await submitVersion(author.id, id, fields(id, "1.0.1", "b"));
    await decide(admin.id, second.id, "reject", "No.");
    const third = await submitVersion(author.id, id, fields(id, "1.0.2", "c"));
    await decide(admin.id, third.id, "approve");
    await setListed(admin.id, id, false);
    await setListed(admin.id, id, true);
    await setOwner(admin.id, id, helper.id);

    const rows = await systemRows(
      `select "kind", "lang", "actorId", "detail" from "activity" where "subject" = $1 order by "id"`,
      [id],
    );
    expect(rows.map((r) => r.kind)).toEqual([
      "pack.submitted",
      "pack.withdrawn",
      "pack.submitted",
      "pack.rejected",
      "pack.submitted",
      "pack.approved",
      "pack.unlisted",
      "pack.listed",
      "pack.owner",
    ]);
    expect(rows.every((r) => r.lang === null)).toBe(true);
    expect(rows[0]).toMatchObject({ actorId: author.id, detail: { packId: id, version: "1.0.0", submissionId: pack.pending!.id } });
    expect(rows[3]).toMatchObject({ actorId: admin.id, detail: { packId: id, version: "1.0.1", reason: "No." } });
    expect(rows[8]).toMatchObject({ detail: { packId: id, ownerId: helper.id } });
  });
});

describe("email", () => {
  it("tells the admins of a submission and the submitter of the decision, without Resend", async () => {
    const id = nextId();
    const pack = await createPack(author.id, newPack(id));
    const submitted = emailed(`Pack submission: Title of ${id} 1.0.0`);
    expect(submitted).toContain(emailOf(admin));
    expect(submitted).not.toContain(emailOf(author));

    await decide(admin.id, pack.pending!.id, "approve");
    expect(emailed(`Your pack Title of ${id} 1.0.0 was approved`)).toEqual([emailOf(author)]);

    const next = await submitVersion(author.id, id, fields(id, "1.1.0", "b"));
    await decide(admin.id, next.id, "reject", "Broken zip.");
    expect(emailed(`Your pack Title of ${id} 1.1.0 was not approved`)).toEqual([emailOf(author)]);
    const body = info.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.includes("was not approved"));
    expect(body).toContain("Broken zip.");
    expect(body).toContain("https://spoken.quest/packs");
  });
});
