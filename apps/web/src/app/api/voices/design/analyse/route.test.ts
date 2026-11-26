import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyseGroup, access, key } = vi.hoisted(() => ({
  analyseGroup: vi.fn(async () => ({ analysis: { id: "a" }, missing: [] })),
  access: { allowed: true },
  key: { value: "g-key" as string | null },
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
    key.value
      ? { key: key.value, denied: null }
      : { key: null, denied: Response.json({ key: provider }, { status: 428 }) },
}));
vi.mock("@/lib/voice-design/analyse", () => ({ analyseGroup }));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("https://example.com/api/voices/design/analyse?lang=enUS", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/voices/design/analyse", () => {
  beforeEach(() => {
    access.allowed = true;
    key.value = "g-key";
    analyseGroup.mockClear();
  });

  it("analyses on the caller's Gemini key", async () => {
    expect((await post({ group: "orc-male" })).status).toBe(200);
    expect(analyseGroup).toHaveBeenCalledWith({ lang: "enUS", group: "orc-male", userId: "u1", apiKey: "g-key" });
  });

  it("refuses somebody without configure", async () => {
    access.allowed = false;
    expect((await post({ group: "orc-male" })).status).toBe(403);
    expect(analyseGroup).not.toHaveBeenCalled();
  });

  it("sends somebody without a Gemini key to their profile", async () => {
    key.value = null;
    const response = await post({ group: "orc-male" });
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ key: "gemini" });
  });

  it("refuses a group that is not a race-gender", async () => {
    expect((await post({ group: "../x" })).status).toBe(400);
  });
});
