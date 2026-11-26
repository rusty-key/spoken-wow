import { describe, expect, it, vi } from "vitest";

import { verifyGeminiKey } from "./gemini";

describe("verifyGeminiKey", () => {
  it("lists the models, which costs nothing, with the key in its header", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ models: [] }));
    expect(await verifyGeminiKey("k-123", { fetchImpl })).toEqual({ tier: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({ headers: { "x-goog-api-key": "k-123" } }),
    );
  });

  it("refuses a key Gemini rejects, with what Gemini said", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    await expect(verifyGeminiKey("bad", { fetchImpl })).rejects.toThrow(/API key not valid/);
  });
});
