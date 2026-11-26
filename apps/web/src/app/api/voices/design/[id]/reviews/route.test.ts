import { describe, expect, it, vi } from "vitest";

const { addReview } = vi.hoisted(() => ({ addReview: vi.fn(async () => {}) }));

vi.mock("@/lib/voice-design/access", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/access")>()),
  requireDesigner: async () => ({ session: { user: { id: "u1" } }, lang: "enUS", denied: null }),
}));
vi.mock("@/lib/voice-design/store", () => ({
  addReview,
  readDesign: async (_lang: string, id: string) => (id === "d1" ? { id, previews: [{}, {}, {}], samples: [] } : null),
}));

const { POST } = await import("./route");

const post = (id: string, body: unknown) =>
  POST(new Request("https://example.com/x?lang=enUS", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("POST /api/voices/design/[id]/reviews", () => {
  it("keeps the verdict under the caller", async () => {
    expect((await post("d1", { status: "good", note: "ok", bestPreview: 0 })).status).toBe(200);
    expect(addReview).toHaveBeenCalledWith("enUS", "d1", expect.objectContaining({ status: "good", userId: "u1" }));
  });

  it("refuses a malformed verdict, and a version the team does not have", async () => {
    expect((await post("d1", { status: "great" })).status).toBe(400);
    expect((await post("d2", { status: "good" })).status).toBe(404);
  });
});
