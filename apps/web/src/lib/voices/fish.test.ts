import { decode } from "@msgpack/msgpack";
import { describe, expect, it, vi } from "vitest";

import { fishConcurrency, fishCost, getWallet, isFishModel, transcribe } from "./fish";

const OPTIONS = { apiKey: "fish-key", baseUrl: "https://stub.invalid" };

function stub(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

describe("the wallet", () => {
  it("is read as self, and its decimal strings as numbers", async () => {
    const { calls, fetchImpl } = stub(
      Response.json({ credit: "12.3400", cumulative_top_up: "150.00", user_id: "u" }),
    );
    expect(await getWallet({ ...OPTIONS, fetchImpl })).toEqual({
      credit: 12.34,
      cumulativeTopUp: 150,
    });
    expect(calls[0].url).toBe("https://stub.invalid/wallet/self/api-credit");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fish-key",
    );
  });

  it("refuses a bad key with fish.audio's own message", async () => {
    const { fetchImpl } = stub(
      new Response(JSON.stringify({ status: 401, message: "Invalid token" }), { status: 401 }),
    );
    await expect(getWallet({ ...OPTIONS, fetchImpl })).rejects.toThrow(/401.*Invalid token/);
  });

  it("needs a key", async () => {
    await expect(getWallet({ baseUrl: OPTIONS.baseUrl })).rejects.toThrow(/no fish.audio key/);
  });
});

describe("concurrency", () => {
  it.each([
    [0, 5],
    [99.99, 5],
    [100, 15],
    [999, 15],
    [1000, 50],
  ])("after $%d paid in is %d", (topUp, limit) => {
    expect(fishConcurrency(topUp)).toBe(limit);
  });
});

describe("cost", () => {
  it("is list price per byte", () => {
    expect(fishCost("s2.1-pro", 1_000_000)).toBe(15);
    expect(fishCost("s2.1-pro-free", 1_000_000)).toBe(0);
  });

  it("is unknown for a model fish.audio has not priced, rather than a guess", () => {
    expect(fishCost("drama-3", 1000)).toBeNull();
    expect(fishCost("no-such-model", 1000)).toBeNull();
  });

  it("knows which models may be chosen", () => {
    expect(isFishModel("s2.1-pro")).toBe(true);
    expect(isFishModel("s1")).toBe(false);
    // Gone from fish.audio's list: sent, it would be spoken and billed as s2.1-pro.
    expect(isFishModel("drama-3-preview")).toBe(false);
  });
});

describe("a transcript", () => {
  it("is asked for in msgpack, with the language as a hint", async () => {
    const { calls, fetchImpl } = stub(Response.json({ text: " Well met. ", duration: 12 }));
    expect(await transcribe(Buffer.from("clip"), "de", { ...OPTIONS, fetchImpl })).toBe(
      "Well met.",
    );
    expect(calls[0].url).toBe("https://stub.invalid/v1/asr");
    const body = decode(calls[0].init!.body as Uint8Array) as { language: string };
    expect(body.language).toBe("de");
  });

  it("fails loudly when none comes back", async () => {
    const { fetchImpl } = stub(Response.json({ duration: 12 }));
    await expect(transcribe(Buffer.from("clip"), null, { ...OPTIONS, fetchImpl })).rejects.toThrow(
      /no transcript/,
    );
  });
});
