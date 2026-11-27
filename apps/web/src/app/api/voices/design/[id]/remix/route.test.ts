import { beforeEach, expect, it, vi } from "vitest";

const { remixVersion, retireOlder } = vi.hoisted(() => ({
  remixVersion: vi.fn(async () => ({ id: "d2" })),
  retireOlder: vi.fn(async () => [{ id: "d1" }]),
}));

vi.mock("@/lib/voice-design/access", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/access")>()),
  requireDesigner: async () => ({ session: { user: { id: "u1" } }, lang: "enUS", denied: null }),
}));
vi.mock("@/lib/generation/authz", () => ({ requireApiKey: async () => ({ key: "el-key", denied: null }) }));
vi.mock("@/lib/voice-design/design", () => ({ remixVersion, retireOlder }));

const { POST } = await import("./route");

beforeEach(() => vi.clearAllMocks());

it("frees the older versions' voices once the remix is made, and says which", async () => {
  const body = { changes: "Colder.", prompt: "A colder orc.", previewText: "x".repeat(120), settings: { promptStrength: 0.5, guidanceScale: null, loudness: null, seed: null } };
  const response = await POST(new Request("https://example.com/api/voices/design/d1/remix?lang=enUS", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "d1" }),
  });
  expect(response.status).toBe(200);
  expect(retireOlder).toHaveBeenCalledWith({ lang: "enUS", kept: { id: "d2" }, userId: "u1", apiKey: "el-key" });
  expect(await response.json()).toEqual({ design: { id: "d2" }, retired: [{ id: "d1" }] });
});
