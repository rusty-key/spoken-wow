import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), speaker: vi.fn(), generate: vi.fn(), pack: vi.fn() }));
vi.mock("@/lib/generation/authz", () => ({ requireIn: mocks.auth, requireSpeaker: mocks.speaker }));
vi.mock("@/lib/combat/regenerate", () => ({ regenerateCombatLine: mocks.generate }));
vi.mock("@/lib/combat/package", () => ({ combatPackage: mocks.pack }));
import { POST } from "./regenerate/route";
import { GET } from "./package/route";

function request(body: unknown = { lineId: "c:nightelf-female-player:01" }) {
  return new Request("https://spoken.test/api/combat/regenerate", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ session: { user: { id: "actor" } }, lang: "enUS", denied: null });
  mocks.speaker.mockResolvedValue({ speaker: { provider: "fish" }, denied: null });
});

it("requires a grant before generating or downloading", async () => {
  mocks.auth.mockResolvedValue({ denied: new Response("denied", { status: 403 }) });
  expect((await POST(request())).status).toBe(403);
  expect((await GET(request())).status).toBe(403);
  expect(mocks.speaker).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.pack).not.toHaveBeenCalled();
});

it("refuses other languages and malformed bodies before resolving a paid provider", async () => {
  mocks.auth.mockResolvedValueOnce({ session: { user: { id: "actor" } }, lang: "frFR", denied: null });
  expect((await POST(request())).status).toBe(400);
  for (const body of [null, {}, { lineId: 1 }]) expect((await POST(request(body))).status).toBe(400);
  expect(mocks.speaker).not.toHaveBeenCalled();
});

it("requires the signed-in person's own provider key", async () => {
  mocks.speaker.mockResolvedValue({ denied: new Response("no key", { status: 428 }) });
  expect((await POST(request())).status).toBe(428);
  expect(mocks.speaker).toHaveBeenCalledWith("actor", "enUS");
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("passes the authenticated actor to recording production", async () => {
  mocks.generate.mockResolvedValue({ ok: true, version: 1 });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.generate).toHaveBeenCalledWith("c:nightelf-female-player:01", "actor", { provider: "fish" });
});

it("refuses an incomplete download and makes complete packages private", async () => {
  mocks.pack.mockRejectedValueOnce(new Error("All 8 needed"));
  expect((await GET(request())).status).toBe(409);
  mocks.pack.mockResolvedValueOnce(Buffer.from("zip"));
  const response = await GET(request());
  expect(response.headers.get("Content-Type")).toBe("application/zip");
  expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="SpokenCombatAudio-0.0.1.zip"');
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).toBe("zip");
});
