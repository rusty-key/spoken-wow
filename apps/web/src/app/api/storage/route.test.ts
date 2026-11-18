/** Needs DATABASE_URL and migrations through 0114; the session and the bucket's answers are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";
import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { placeObject, testBackend } from "@/lib/storage/testing";
import { asSystem, ownTeam, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: "member" } }),
}));

const probed = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("@/lib/storage/probe", () => probed);

import { DELETE, PATCH, POST as ACT } from "./[id]/route";
import { GET, POST } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let restoreArchive = () => {};

const BUCKET = {
  provider: "s3",
  endpoint: "https://198.51.100.7",
  region: "eu-west-1",
  bucket: "team-audio",
  publicUrl: "https://203.0.113.9/audio",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "very-secret",
};

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const make = (lang: string, body: unknown = BUCKET) => POST(new Request(`http://x/api/storage?lang=${lang}`, json(body)));
const act = (lang: string, id: string, action: string) =>
  ACT(new Request(`http://x/api/storage/${id}?lang=${lang}`, json({ action })), { params: Promise.resolve({ id }) });
const OK = { ok: true, conditionalPut: true, steps: [{ name: "Write an object", ok: true }] };

beforeAll(async () => {
  vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 3).toString("base64"));
  user = await testUser("test-storage-route");
  who.id = user.id;
  fr = await ownTeam("frFR");
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, 'frFR', 'admin', $2)`,
    [fr.team, user.id],
  );
});

beforeEach(() => {
  probed.probe.mockReset().mockResolvedValue(OK);
  restoreArchive = useArchiveForTests(memoryBlobs(), "r2");
});

afterEach(async () => {
  restoreArchive();
  await asSystem.query(`delete from "archive_object" where "teamId" = $1`, [fr.team]);
  await asSystem.query(`delete from "storage_backend" where "teamId" = $1`, [fr.team]);
});

afterAll(async () => {
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
  await fr.restore();
  await user.cleanup();
  vi.unstubAllEnvs();
  await closeDb();
});

describe("storage routes", () => {
  it("answers 403 to somebody who does not administer the language", async () => {
    expect((await make(BASE_LANG)).status).toBe(403);
    expect((await GET(new Request(`http://x/api/storage?lang=${BASE_LANG}`))).status).toBe(403);
  });

  it("saves a bucket with its secret sealed, never shown", async () => {
    const res = await make("frFR");
    expect(res.status).toBe(201);
    const { backend } = await res.json();
    expect(backend).toMatchObject({ bucket: "team-audio", pathStyle: false, publicUrl: "https://203.0.113.9/audio/", health: "unchecked", writing: false });
    expect(JSON.stringify(backend)).not.toContain("very-secret");
    const [row] = (await asSystem.query(`select "secretSealed", "teamId" from "storage_backend" where "id" = $1`, [backend.id])).rows;
    expect(row.secretSealed).toMatch(/^v1:/);
    expect(row.secretSealed).not.toContain("very-secret");
    expect(row.teamId).toBe(fr.team);

    const view = await (await GET(new Request("http://x/api/storage?lang=frFR"))).json();
    expect(view.backends.map((b: { id: string }) => b.id)).toEqual([backend.id]);
  });

  it("addresses a dotted bucket by path, which the provider's certificate covers", async () => {
    const { backend } = await (await make("frFR", { ...BUCKET, bucket: "audio.example.org" })).json();
    expect(backend.pathStyle).toBe(true);
  });

  it("refuses a bucket on a private address", async () => {
    const res = await make("frFR", { ...BUCKET, endpoint: "https://169.254.169.254" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("private or local");
  });

  it("sends new objects to a bucket only once it passed a test", async () => {
    const { backend } = await (await make("frFR")).json();
    expect((await act("frFR", backend.id, "write")).status).toBe(409);

    probed.probe.mockResolvedValueOnce({ ok: false, conditionalPut: true, steps: [{ name: "Read part of it", ok: false, detail: "ignored Range" }] });
    const failed = await (await act("frFR", backend.id, "test")).json();
    expect(failed.backend).toMatchObject({ health: "failing", lastError: "Read part of it: ignored Range" });

    expect((await act("frFR", backend.id, "test")).status).toBe(200);
    const on = await (await act("frFR", backend.id, "write")).json();
    expect(on.backend).toMatchObject({ health: "ok", writing: true, lastError: null });

    const off = await (await act("frFR", backend.id, "stop")).json();
    expect(off.backend.writing).toBe(false);
  });

  it("keeps one bucket taking new objects per team", async () => {
    const a = (await (await make("frFR")).json()).backend;
    const b = (await (await make("frFR", { ...BUCKET, bucket: "second" })).json()).backend;
    for (const id of [a.id, b.id]) await act("frFR", id, "test");
    await act("frFR", a.id, "write");
    await act("frFR", b.id, "write");
    const { rows } = await asSystem.query(`select "id" from "storage_backend" where "teamId" = $1 and "writing"`, [fr.team]);
    expect(rows.map((r) => r.id)).toEqual([b.id]);
  });

  it("refuses a team bucket while our archive is still the volume", async () => {
    restoreArchive();
    restoreArchive = useArchiveForTests(memoryBlobs(), "dual");
    const { backend } = await (await make("frFR")).json();
    await act("frFR", backend.id, "test");
    const res = await act("frFR", backend.id, "write");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("SPOKEN_ARCHIVE_STORE=r2");
  });

  it("retires a bucket for good, and removes only one that holds nothing", async () => {
    const { backend } = await (await make("frFR")).json();
    await placeObject(`takes/${"b".repeat(64)}`, backend.id);
    const del = () => DELETE(new Request(`http://x/api/storage/${backend.id}?lang=frFR`, { method: "DELETE" }), { params: Promise.resolve({ id: backend.id }) });
    expect((await del()).status).toBe(409);

    const retired = await (await act("frFR", backend.id, "retire")).json();
    expect(retired.backend.retiredAt).not.toBeNull();
    await act("frFR", backend.id, "test");
    expect((await act("frFR", backend.id, "write")).status).toBe(409);

    await asSystem.query(`delete from "archive_object" where "backendId" = $1`, [backend.id]);
    expect((await del()).status).toBe(204);
  });

  it("tests a new key at once", async () => {
    const { backend } = await (await make("frFR")).json();
    const res = await PATCH(
      new Request(`http://x/api/storage/${backend.id}?lang=frFR`, { method: "PATCH", body: JSON.stringify({ accessKeyId: "NEW", secretAccessKey: "s2" }) }),
      { params: Promise.resolve({ id: backend.id }) },
    );
    const answer = await res.json();
    expect(answer.backend).toMatchObject({ accessKeyId: "NEW", health: "ok" });
    expect(answer.test.ok).toBe(true);
    expect(probed.probe).toHaveBeenCalledOnce();
  });

  it("finds no other team's bucket", async () => {
    const de = await ownTeam("deDE");
    try {
      const theirs = await testBackend({ team: de.team });
      expect((await act("frFR", theirs.id, "test")).status).toBe(404);
    } finally {
      await de.restore();
    }
  });
});
