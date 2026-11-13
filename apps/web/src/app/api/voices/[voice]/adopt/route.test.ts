/**
 * Adopting renames a voice in the caller's account to the slot's name. What is pinned here is
 * that an occupied slot is never silently taken over, and that the occupant is renamed away
 * rather than deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountVoices, renameVoice, recordClone, recordActivity } = vi.hoisted(() => ({
  listAccountVoices: vi.fn(),
  renameVoice: vi.fn(async () => {}),
  recordClone: vi.fn(async () => {}),
  recordActivity: vi.fn(async () => {}),
}));

vi.mock("@/lib/voices/authz", () => ({
  requireVoiceViewer: async () => ({
    session: { user: { id: "admin" } },
    lang: "deDE",
    manager: true,
    denied: null,
  }),
}));
vi.mock("@/lib/generation/authz", () => ({
  requireApiKey: async () => ({ key: "el-key", denied: null }),
}));
vi.mock("@/lib/generation/status", () => ({ invalidateStatus: () => {} }));
vi.mock("@/lib/activity/store", () => ({ recordActivity }));
vi.mock("@/lib/voices/clones", () => ({ recordClone }));
vi.mock("@/lib/voices/elevenlabs", () => ({
  listAccountVoices,
  renameVoice,
  isRenamable: (voice: { category: string }) => voice.category !== "premade",
}));

import { POST } from "./route";

const SLOT = "spirithealer";
const CLONE = "spirithealer@deDE";

function adopt(body: unknown) {
  return POST(
    new Request(`https://example.com/api/voices/${SLOT}/adopt?lang=deDE`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ voice: SLOT }) },
  );
}

describe("POST /api/voices/[voice]/adopt", () => {
  beforeEach(() => {
    renameVoice.mockClear();
    recordClone.mockClear();
    listAccountVoices.mockResolvedValue([
      { voiceId: "lib1", name: "Grim Sage", category: "professional" },
      { voiceId: "stock1", name: "Roger", category: "premade" },
    ]);
  });

  it("renames the picked voice to the slot's clone name and records it", async () => {
    const response = await adopt({ voiceId: "lib1" });
    expect(response.status).toBe(201);
    expect(renameVoice).toHaveBeenCalledTimes(1);
    expect(renameVoice).toHaveBeenCalledWith("lib1", CLONE, { apiKey: "el-key" });
    expect(recordClone).toHaveBeenCalledWith(
      expect.objectContaining({ voice: SLOT, voiceId: "lib1", sampleCount: 0, lang: "deDE" }),
    );
  });

  it("refuses an occupied slot without replace", async () => {
    listAccountVoices.mockResolvedValue([
      { voiceId: "lib1", name: "Grim Sage", category: "professional" },
      { voiceId: "old", name: CLONE, category: "cloned" },
    ]);
    expect((await adopt({ voiceId: "lib1" })).status).toBe(409);
    expect(renameVoice).not.toHaveBeenCalled();
  });

  it("renames the occupant away, never deletes it, when replacing", async () => {
    listAccountVoices.mockResolvedValue([
      { voiceId: "lib1", name: "Grim Sage", category: "professional" },
      { voiceId: "old", name: CLONE, category: "cloned" },
    ]);
    expect((await adopt({ voiceId: "lib1", replace: true })).status).toBe(201);
    expect(renameVoice.mock.calls).toEqual([
      ["old", `${CLONE} (replaced)`, { apiKey: "el-key" }],
      ["lib1", CLONE, { apiKey: "el-key" }],
    ]);
  });

  it("refuses a premade voice", async () => {
    expect((await adopt({ voiceId: "stock1" })).status).toBe(400);
    expect(renameVoice).not.toHaveBeenCalled();
  });

  it("refuses a voice that is not in the account", async () => {
    expect((await adopt({ voiceId: "elsewhere" })).status).toBe(404);
  });

  it("answers 502 when ElevenLabs refuses the rename", async () => {
    renameVoice.mockRejectedValueOnce(new Error("voice_not_editable"));
    expect((await adopt({ voiceId: "lib1" })).status).toBe(502);
    expect(recordClone).not.toHaveBeenCalled();
  });
});
