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

  it("answers Gemini's failure with a status Cloudflare passes through, so the page can say it", async () => {
    reviseDesign.mockRejectedValueOnce(new Error("Gemini failed (402): billing"));
    const response = await POST(new Request("https://example.com/x?lang=enUS", { method: "POST" }), { params: Promise.resolve({ id: "d1" }) });
    // Cloudflare swaps an origin's 502 or 504 body for its own page.
    expect([502, 504]).not.toContain(response.status);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).toEqual({ error: "Gemini failed (402): billing" });
  });
});
