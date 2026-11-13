/**
 * Resume reaches the same languages Stop does: a translator's Resume resumes their
 * language and nobody else's.
 */
import { describe, expect, it, vi } from "vitest";

const { authorise, resumeQueue } = vi.hoisted(() => ({
  authorise: vi.fn(),
  resumeQueue: vi.fn(async () => ["ptBR"]),
}));

vi.mock("@/lib/generation/authz", () => ({
  requireAnyRegenerate: async () => authorise(),
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {}, queueWorker: () => null }));
vi.mock("@/lib/generation/queue", () => ({ resumeQueue }));

import { POST } from "./route";

describe("POST /api/regenerate/queue/resume", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      langs: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST()).status).toBe(403);
    expect(resumeQueue).not.toHaveBeenCalled();
  });

  it("resumes only the languages the caller regenerates in", async () => {
    authorise.mockResolvedValueOnce({
      session: { user: { id: "u1", name: "Ana" } },
      langs: ["ptBR"],
      denied: null,
    });

    const response = await POST();

    expect(await response.json()).toEqual({ resumed: ["ptBR"] });
    expect(resumeQueue).toHaveBeenCalledWith(["ptBR"], "u1");
  });
});
