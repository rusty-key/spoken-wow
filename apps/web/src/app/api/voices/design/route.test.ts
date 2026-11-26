import { beforeEach, describe, expect, it, vi } from "vitest";

const { designVersion, saveDesignVoice, deleteDesignVoice, access, key } = vi.hoisted(() => ({
  designVersion: vi.fn(async () => ({ id: "d1" })),
  saveDesignVoice: vi.fn(async () => ({ id: "d1" })),
  deleteDesignVoice: vi.fn(async () => ({ id: "d1" })),
  access: { allowed: true },
  key: { value: "el-key" as string | null },
}));

vi.mock("@/lib/voice-design/access", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/access")>()),
  requireDesigner: async () =>
    access.allowed
      ? { session: { user: { id: "u1" } }, lang: "enUS", denied: null }
      : { session: null, lang: null, denied: Response.json({}, { status: 403 }) },
}));
vi.mock("@/lib/generation/authz", () => ({
  requireApiKey: async (_user: string, provider: string) =>
    key.value ? { key: key.value, denied: null } : { key: null, denied: Response.json({ key: provider }, { status: 428 }) },
}));
vi.mock("@/lib/voice-design/design", () => ({ designVersion, saveDesignVoice, deleteDesignVoice }));

const { POST } = await import("./route");
const voice = await import("./[id]/voice/route");
const { DesignError } = await import("@/lib/voice-design/access");

const url = "https://example.com/api/voices/design?lang=enUS";
const params = { params: Promise.resolve({ id: "d1" }) };

beforeEach(() => {
  access.allowed = true;
  key.value = "el-key";
  vi.clearAllMocks();
});

describe("POST /api/voices/design", () => {
  const body = { slot: "orc-male-shady", prompt: "A gruff orc.", previewText: "x".repeat(120), analysisId: "a1" };

  it("designs on the caller's ElevenLabs key", async () => {
    const response = await POST(new Request(url, { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect(designVersion).toHaveBeenCalledWith({ lang: "enUS", ...body, revisionHeard: null, userId: "u1", apiKey: "el-key" });
  });

  it("refuses without configure, and without a key", async () => {
    access.allowed = false;
    expect((await POST(new Request(url, { method: "POST", body: JSON.stringify(body) }))).status).toBe(403);
    access.allowed = true;
    key.value = null;
    expect((await POST(new Request(url, { method: "POST", body: JSON.stringify(body) }))).status).toBe(428);
    expect(designVersion).not.toHaveBeenCalled();
  });

  it("answers a refusal of the request with its own status", async () => {
    designVersion.mockRejectedValueOnce(new DesignError("the preview text must be 100 to 1000 characters", 400));
    const response = await POST(new Request(url, { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "the preview text must be 100 to 1000 characters" });
  });
});

describe("/api/voices/design/[id]/voice", () => {
  it("saves the preview asked for", async () => {
    const response = await voice.POST(new Request(url, { method: "POST", body: JSON.stringify({ preview: 2 }) }), params);
    expect(response.status).toBe(200);
    expect(saveDesignVoice).toHaveBeenCalledWith({ lang: "enUS", id: "d1", preview: 2, userId: "u1", apiKey: "el-key" });
  });

  it("deletes as the caller, whose key it is", async () => {
    expect((await voice.DELETE(new Request(url, { method: "DELETE" }), params)).status).toBe(200);
    expect(deleteDesignVoice).toHaveBeenCalledWith({ lang: "enUS", id: "d1", userId: "u1", apiKey: "el-key" });
  });

  it("says whose account it is when somebody else tries", async () => {
    deleteDesignVoice.mockRejectedValueOnce(new DesignError("v3's voice is in Bo's ElevenLabs account; only they can use it", 403));
    const response = await voice.DELETE(new Request(url, { method: "DELETE" }), params);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/Bo/);
  });
});
