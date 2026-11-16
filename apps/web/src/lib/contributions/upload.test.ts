import { describe, expect, it, vi } from "vitest";

import { MAX_ENVELOPES } from "./saved-variables";
import { chunksOf, sendInChunks } from "./upload";

const accepted = (chunk: string[]) =>
  Response.json({ accepted: chunk.length, refused: {} });

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}`);

describe("chunksOf", () => {
  it("splits by count and by size", () => {
    expect(chunksOf(["a", "b", "c"], 2).map((c) => c.length)).toEqual([2, 1]);
    expect(chunksOf(["aaaa", "bbbb", "cccc"], 10, 10).map((c) => c.length)).toEqual([1, 1, 1]);
    expect(chunksOf([])).toEqual([]);
  });
});

describe("sendInChunks", () => {
  it("sends every line of a file past one request's cap", async () => {
    const post = vi.fn(async (chunk: string[]) => accepted(chunk));
    const progress: number[] = [];
    const outcome = await sendInChunks(lines(MAX_ENVELOPES + 1), post, (sent) => progress.push(sent));

    expect(post.mock.calls.map(([chunk]) => chunk.length)).toEqual([MAX_ENVELOPES, 1]);
    expect(outcome).toEqual({ sent: MAX_ENVELOPES + 1, accepted: MAX_ENVELOPES + 1, refused: 0 });
    expect(progress).toEqual([MAX_ENVELOPES, MAX_ENVELOPES + 1]);
  });

  it("adds up what each request refused", async () => {
    const outcome = await sendInChunks(lines(1), async () =>
      Response.json({ accepted: 0, refused: { checksum: 1, malformed: 2 } }),
    );
    expect(outcome).toMatchObject({ accepted: 0, refused: 3 });
  });

  it("stops at the first failure and says how far it got", async () => {
    const post = vi
      .fn<(chunk: string[]) => Promise<Response | null>>()
      .mockImplementationOnce(async (chunk) => accepted(chunk))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    const outcome = await sendInChunks(lines(MAX_ENVELOPES * 3), post);

    expect(post).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ sent: MAX_ENVELOPES, accepted: MAX_ENVELOPES, refused: 0, failedWith: 429 });
  });

  it("reports no response at all as null", async () => {
    expect(await sendInChunks(lines(1), async () => null)).toMatchObject({ sent: 0, failedWith: null });
  });

  it("treats a success it cannot read as a failed request, without throwing", async () => {
    const page = await sendInChunks(lines(1), async () => new Response("<html>"));
    expect(page).toMatchObject({ sent: 0, failedWith: null });
    const other = await sendInChunks(lines(1), async () => Response.json({ ok: true }));
    expect(other).toMatchObject({ sent: 0, failedWith: null });
  });

  it("adds an earlier try's totals to this one", async () => {
    const outcome = await sendInChunks(lines(2), async (chunk) => accepted(chunk), undefined, {
      accepted: 2000,
      refused: 300,
    });
    expect(outcome).toEqual({ sent: 2, accepted: 2002, refused: 300 });
  });
});
