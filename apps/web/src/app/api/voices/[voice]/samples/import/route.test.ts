/**
 * The clips of a language other than English live under that language's clone, and every
 * step of seeding has to address them there -- merging them from the English slot's
 * directory found nothing and failed with ENOENT on the first French seed.
 */
import { describe, expect, it, vi } from "vitest";

const { mergeSamples, storeSample } = vi.hoisted(() => ({
  mergeSamples: vi.fn(async () => ({ file: "merged.mp3" })),
  storeSample: vi.fn(async (_clone: string, file: string) => ({ file })),
}));

vi.mock("@/lib/voices/authz", () => ({
  requireVoiceManager: async (request: Request) => ({
    session: { user: { id: "admin" } },
    lang: new URL(request.url).searchParams.get("lang") ?? "enUS",
    denied: null,
  }),
}));
vi.mock("@/lib/activity/store", () => ({ recordActivities: async () => {} }));
vi.mock("@/lib/voices/seedClips", () => ({
  seedClips: async () => ["/clips/A01.ogg", "/clips/A02.ogg"],
}));
vi.mock("@/lib/voices/samples", () => ({
  listSamples: async () => [],
  deleteSample: async () => true,
  storeSample,
}));
vi.mock("@/lib/voices/merge", () => ({ DEFAULT_PAUSE_SECONDS: 1, mergeSamples }));
vi.mock("node:fs/promises", () => ({ default: { readFile: async () => Buffer.from("") } }));
vi.mock("@/lib/lang-server", () => ({
  langParam: async (request: Request) => ({
    lang: new URL(request.url).searchParams.get("lang") ?? "enUS",
    denied: null,
  }),
}));

import { POST } from "./route";

function seed(lang: string) {
  return POST(
    new Request(`https://example.com/api/voices/tauren-female-official/samples/import?lang=${lang}`, {
      method: "POST",
      body: JSON.stringify({ replace: true }),
    }),
    { params: Promise.resolve({ voice: "tauren-female-official" }) },
  );
}

describe("POST /api/voices/[voice]/samples/import", () => {
  it("stores and merges another language's clips under its own clone", async () => {
    const response = await seed("frFR");

    expect(response.status).toBe(201);
    expect(storeSample).toHaveBeenCalledWith("tauren-female-official@frFR", "A01.ogg", expect.anything());
    expect(mergeSamples).toHaveBeenLastCalledWith(
      "tauren-female-official@frFR",
      ["A01.ogg", "A02.ogg"],
      1,
    );
  });

  it("keeps English where it always was", async () => {
    await seed("enUS");

    expect(mergeSamples).toHaveBeenLastCalledWith("tauren-female-official", ["A01.ogg", "A02.ogg"], 1);
  });
});
