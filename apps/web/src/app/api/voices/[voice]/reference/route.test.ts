/**
 * Cutting a reference changes what every fish.audio line in the language is spoken from, so
 * the store logs who cut it (references.ts). What is left to pin here is that the route hands
 * the store the signed-in admin and the language asked for, not somebody else's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveReference, deleteReference } = vi.hoisted(() => ({
  saveReference: vi.fn(async () => ({ transcript: "Well met." })),
  deleteReference: vi.fn(async () => {}),
}));

vi.mock("@/lib/voices/authz", () => ({
  requireVoiceManager: async () => ({ session: { user: { id: "admin" } }, denied: null }),
  requireVoiceViewer: async () => ({ denied: Response.json({}, { status: 403 }) }),
}));
vi.mock("@/lib/generation/authz", () => ({
  requireApiKey: async () => ({ key: "fish-key", denied: null }),
}));
vi.mock("@/lib/voices/fish", () => ({ transcribe: async () => "Well met." }));
vi.mock("@/lib/voices/references", () => ({
  saveReference,
  rejectWindow: () => null,
  readReference: async () => null,
  saveTranscript: async () => null,
  deleteReference,
}));
vi.mock("@/lib/voices/samples", () => ({
  isStoredSampleName: () => true,
  withSampleFiles: async (_clone: string, _files: string[], use: (paths: string[]) => unknown) =>
    use(["/clips/clip.mp3"]),
}));
vi.mock("@/lib/lang-server", () => ({
  langParam: async (request: Request) => ({
    lang: new URL(request.url).searchParams.get("lang") ?? "enUS",
    denied: null,
  }),
}));

import { DELETE, POST } from "./route";

const SAMPLE = "1700000000000-abc.mp3";

function cut() {
  return POST(
    new Request("https://example.com/api/voices/tauren-female-official/reference?lang=frFR", {
      method: "POST",
      body: JSON.stringify({ sample: SAMPLE, startSec: 0, endSec: 15 }),
    }),
    { params: Promise.resolve({ voice: "tauren-female-official" }) },
  );
}

describe("POST /api/voices/[voice]/reference", () => {
  beforeEach(() => saveReference.mockClear());

  it("cuts as the signed-in admin, in the language asked for", async () => {
    expect((await cut()).status).toBe(200);
    expect(saveReference).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "tauren-female-official",
        lang: "frFR",
        sample: SAMPLE,
        userId: "admin",
      }),
    );
  });

  it("answers 502 when the cut fails", async () => {
    saveReference.mockRejectedValueOnce(new Error("fish.audio heard nothing in that window"));
    expect((await cut()).status).toBe(502);
  });
});

describe("DELETE /api/voices/[voice]/reference", () => {
  it("removes it as the signed-in admin", async () => {
    const response = await DELETE(
      new Request("https://example.com/api/voices/tauren-female-official/reference?lang=frFR", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ voice: "tauren-female-official" }) },
    );
    expect(response.status).toBe(200);
    expect(deleteReference).toHaveBeenCalledWith("tauren-female-official", "frFR", "admin");
  });
});
