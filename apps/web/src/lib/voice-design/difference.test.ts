import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { differenceFromLive } = await import("./difference");
import type { CorpusLine } from "@/lib/corpus";
import type { DifferenceDeps } from "./difference";
import type { Design } from "./types";

const DESIGN = {
  id: "d1",
  slot: "dwarf-male-guard",
  version: 4,
  samples: [
    { position: 0, sha256: "a".repeat(64), lineId: "q:1:accept", text: "[thick Scottish accent] Aye.", npcName: null, characters: 1, credits: 1 },
    { position: 1, sha256: "b".repeat(64), lineId: "g:abc", text: "Halt.", npcName: null, characters: 1, credits: 1 },
  ],
} as Design;

function deps(over: Partial<DifferenceDeps> = {}): DifferenceDeps {
  return {
    read: async () => DESIGN,
    line: async (_lang, lineId) => ({ lineId }) as CorpusLine,
    live: async (line) => Buffer.from(`live ${line.lineId}`),
    audio: async (sha) => Buffer.from(`new ${sha[0]}`),
    describe: vi.fn(async () => ({ summary: "accent fades", aspects: [] })),
    ...over,
  };
}

const input = { lang: "enUS" as const, id: "d1", position: 1, apiKey: "k" };

describe("differenceFromLive", () => {
  it("has Gemini hear the chosen line's live take, then this version's take of it", async () => {
    const d = deps();
    expect(await differenceFromLive(input, d)).toEqual({ summary: "accent fades", aspects: [] });
    const [call] = vi.mocked(d.describe).mock.calls[0];
    expect(call).toMatchObject({ apiKey: "k", slot: "dwarf-male-guard", version: 4, text: "Halt." });
    expect([call.live.toString(), call.sample.toString()]).toEqual(["live g:abc", "new b"]);
  });

  it("asks nothing of Gemini when a line has no live take", async () => {
    const d = deps({ live: async () => null });
    await expect(differenceFromLive(input, d)).rejects.toThrow(/no live take/);
    expect(d.describe).not.toHaveBeenCalled();
  });

  it("refuses a line the version does not have", async () => {
    await expect(differenceFromLive({ ...input, position: 5 }, deps())).rejects.toThrow(/no sample line 6/);
  });
});
