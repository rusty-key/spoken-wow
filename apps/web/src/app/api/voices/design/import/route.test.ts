import { beforeEach, describe, expect, it, vi } from "vitest";

const { importVersion, access } = vi.hoisted(() => ({
  importVersion: vi.fn(async () => ({ id: "d1", name: "orc-male-shady-v2" })),
  access: { admin: true },
}));

vi.mock("@/lib/voice-design/access", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/access")>()),
  requireDesigner: async () => ({ session: { user: { id: "admin" } }, lang: "enUS", admin: access.admin, denied: null }),
}));
vi.mock("@/lib/voice-design/import", async (original) => ({
  ...(await original<typeof import("@/lib/voice-design/import")>()),
  importVersion,
}));

const { POST } = await import("./route");

function upload() {
  const form = new FormData();
  const meta = { slot: "orc-male-shady", version: 2, prompt: "p", preview_text: "t", lines: [] };
  form.append("files", new File([JSON.stringify(meta)], "orc-male-shady-v2/meta.json"));
  form.append("files", new File(["p0"], "orc-male-shady-v2/preview0.mp3"));
  form.append("reviews", JSON.stringify([{ status: "good", note: "" }]));
  return POST(new Request("https://example.com/api/voices/design/import?lang=enUS", { method: "POST", body: form }));
}

describe("POST /api/voices/design/import", () => {
  beforeEach(() => {
    access.admin = true;
    importVersion.mockClear();
  });

  it("imports a folder as the admin", async () => {
    const response = await upload();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "orc-male-shady-v2", imported: true });
    expect(importVersion).toHaveBeenCalledWith(expect.objectContaining({ reviews: [expect.objectContaining({ status: "good" })] }), {
      lang: "enUS",
      userId: "admin",
    });
  });

  it("is for admins only", async () => {
    access.admin = false;
    expect((await upload()).status).toBe(403);
    expect(importVersion).not.toHaveBeenCalled();
  });
});
