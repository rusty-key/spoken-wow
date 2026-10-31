/**
 * Deleting a clip leaves nothing on disk, so the activity row is the only record of it. A clip
 * is behind a grant, so in r2 mode it is answered through the site, never redirected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteSample, recordActivity, sampleKey } = vi.hoisted(() => ({
  deleteSample: vi.fn(async () => true),
  recordActivity: vi.fn(async () => {}),
  sampleKey: vi.fn(async (): Promise<string | null | undefined> => undefined),
}));

vi.mock("@/lib/voices/authz", () => ({
  requireVoiceManager: async () => ({ session: { user: { id: "admin" } }, denied: null }),
  requireVoiceViewer: async () => ({ lang: "frFR", denied: null }),
}));
vi.mock("@/lib/voices/samples", () => ({
  contentTypeOf: () => "audio/mpeg",
  deleteSample,
  isStoredSampleName: () => true,
  samplePath: async () => "",
  sampleKey,
}));
vi.mock("@/lib/activity/store", () => ({ recordActivity }));
vi.mock("@/lib/lang-server", () => ({
  langParam: async (request: Request) => ({
    lang: new URL(request.url).searchParams.get("lang") ?? "enUS",
    denied: null,
  }),
}));

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";

import { DELETE, GET } from "./route";

const FILE = "1700000000000-abc.mp3";

function remove() {
  return DELETE(
    new Request(`https://example.com/api/voices/tauren-female-official/samples/${FILE}?lang=frFR`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ voice: "tauren-female-official", file: FILE }) },
  );
}

describe("DELETE /api/voices/[voice]/samples/[file]", () => {
  beforeEach(() => recordActivity.mockClear());

  it("records who deleted which clip, in the language it was deleted from", async () => {
    expect((await remove()).status).toBe(200);
    expect(recordActivity).toHaveBeenCalledWith({
      kind: "sample.deleted",
      lang: "frFR",
      actorId: "admin",
      subject: "tauren-female-official",
      detail: { files: [FILE] },
    });
  });

  it("records nothing when there was no such clip", async () => {
    deleteSample.mockResolvedValueOnce(false);
    expect((await remove()).status).toBe(404);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("GET /api/voices/[voice]/samples/[file] in r2 mode", () => {
  const key = `samples/${"c".repeat(64)}`;
  const play = () =>
    GET(new Request(`https://example.com/api/voices/tauren-female-official/samples/${FILE}?lang=frFR`), {
      params: Promise.resolve({ voice: "tauren-female-official", file: FILE }),
    });

  it("streams the clip privately rather than redirecting to the public bucket", async () => {
    const bucket = memoryBlobs();
    bucket.objects.set(key, { data: Buffer.from("clip bytes"), contentType: "audio/mpeg" });
    const restore = useArchiveForTests(bucket, "r2");
    sampleKey.mockResolvedValueOnce(key);
    try {
      const res = await play();
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("cache-control")).toMatch(/^private/);
      expect(await res.text()).toBe("clip bytes");
    } finally {
      restore();
    }
  });

  it("is a 404 for a clip the bucket has no row for", async () => {
    sampleKey.mockResolvedValueOnce(null);
    expect((await play()).status).toBe(404);
  });
});
