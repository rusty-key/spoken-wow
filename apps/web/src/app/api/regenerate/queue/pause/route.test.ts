/**
 * Pause reaches the same languages Stop does: a translator's Pause pauses their
 * language and nobody else's.
 */
import { describe, expect, it, vi } from "vitest";

const { authorise, pauseQueue } = vi.hoisted(() => ({
  authorise: vi.fn(),
  pauseQueue: vi.fn(async () => ["ptBR"]),
}));

vi.mock("@/lib/generation/authz", () => ({
  requireAnyRegenerate: async () => authorise(),
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {}, queueWorker: () => null }));
vi.mock("@/lib/generation/queue", () => ({ pauseQueue }));

import { POST } from "./route";

describe("POST /api/regenerate/queue/pause", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      langs: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST()).status).toBe(403);
    expect(pauseQueue).not.toHaveBeenCalled();
  });

  it("pauses only the languages the caller regenerates in", async () => {
    authorise.mockResolvedValueOnce({
      session: { user: { id: "u1", name: "Ana" } },
      langs: ["ptBR"],
      denied: null,
    });

    const response = await POST();

    expect(await response.json()).toEqual({ paused: ["ptBR"] });
    expect(pauseQueue).toHaveBeenCalledWith(["ptBR"], "u1");
  });
});
