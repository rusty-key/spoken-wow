import { describe, expect, it, vi } from "vitest";

const { reviseDesign } = vi.hoisted(() => ({ reviseDesign: vi.fn(async () => ({ heard: "h", prompt: "p", preview_text: "t" })) }));

vi.mock("@/lib/voice-design/access", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/access")>()),
  requireDesigner: async () => ({ session: { user: { id: "u1" } }, lang: "enUS", denied: null }),
}));
vi.mock("@/lib/generation/authz", () => ({ requireApiKey: async () => ({ key: "g-key", denied: null }) }));
vi.mock("@/lib/voice-design/revise", () => ({ reviseDesign }));

const { POST } = await import("./route");

describe("POST /api/voices/design/[id]/revise", () => {
  it("drafts on the caller's Gemini key", async () => {
    const response = await POST(new Request("https://example.com/x?lang=enUS", { method: "POST" }), { params: Promise.resolve({ id: "d1" }) });
    expect(await response.json()).toEqual({ revision: { heard: "h", prompt: "p", preview_text: "t" } });
    expect(reviseDesign).toHaveBeenCalledWith({ lang: "enUS", id: "d1", apiKey: "g-key" });
  });
});
