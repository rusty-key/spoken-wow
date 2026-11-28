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
  prompt: "A dwarf guard.",
  analysis: { archetype: "Ironforge guards" },
  reviews: [
    { status: "needs-work", note: "accent too weak", observations: [{ by: "gemini", note: "accent fades" }] },
    { status: "needs-work", note: "" },
  ],
  samples: [
    { position: 0, sha256: "a".repeat(64), lineId: "q:1:accept", text: "[thick Scottish accent] Aye.", npcName: null, characters: 1, credits: 1 },
    { position: 1, sha256: "b".repeat(64), lineId: "g:abc", text: "Halt.", npcName: null, characters: 1, credits: 1 },
  ],
} as unknown as Design;

const SAID = { summary: "accent fades", note: "accent fades", wish: "keep the accent strong", aspects: [] };

function deps(over: Partial<DifferenceDeps> = {}): DifferenceDeps {
  return {
    read: async () => DESIGN,
    line: async (_lang, lineId) => ({ lineId }) as CorpusLine,
    live: async (line) => Buffer.from(`live ${line.lineId}`),
    audio: async (sha) => Buffer.from(`new ${sha[0]}`),
    reference: async () => Buffer.from("ref"),
    analysis: async () => null,
    measure: vi.fn(async () => [{ f0Hz: 89, durationSec: 4 }, { f0Hz: 110, durationSec: 4 }, { f0Hz: 136, durationSec: 5 }]),
    view: vi.fn(async () => Buffer.from("png")),
    describe: vi.fn(async () => SAID),
    describeClaude: vi.fn(async () => ({ ...SAID, fixes: ["Add 'gravelly'."] })),
    ...over,
  };
}

const input = { lang: "enUS" as const, id: "d1", position: 1, apiKey: "k", by: "gemini" as const };

describe("differenceFromLive", () => {
  it("has Gemini hear the game reference, the chosen line's live take, then this version's take of it", async () => {
    const d = deps();
    expect(await differenceFromLive(input, d)).toEqual({ ...SAID, by: "gemini" });
    const [call] = vi.mocked(d.describe).mock.calls[0];
    expect(call).toMatchObject({ apiKey: "k", slot: "dwarf-male-guard", version: 4, text: "Halt." });
    expect([call.reference?.toString(), call.live.toString(), call.sample.toString()]).toEqual(["ref", "live g:abc", "new b"]);
    expect(d.describeClaude).not.toHaveBeenCalled();
  });

  it("still asks Gemini when the slot has no reference clip", async () => {
    const d = deps({ reference: async () => null });
    await differenceFromLive(input, d);
    expect(vi.mocked(d.describe).mock.calls[0][0].reference).toBeNull();
  });

  it("gives Claude the picture, the numbers, who uses the voice, the prompt and the reviewers' own notes", async () => {
    const d = deps();
    const said = await differenceFromLive({ ...input, by: "claude" }, d);
    expect(said).toEqual({ ...SAID, fixes: ["Add 'gravelly'."], by: "claude", image: Buffer.from("png").toString("base64") });
    const [clips] = vi.mocked(d.view).mock.calls[0];
    expect([clips.reference, clips.live, clips.sample].map(String)).toEqual(["ref", "live g:abc", "new b"]);
    expect(clips.label).toBe("v4");
    const [call] = vi.mocked(d.describeClaude).mock.calls[0];
    expect(call).toMatchObject({ apiKey: "k", slot: "dwarf-male-guard", version: 4, text: "Halt.", archetype: "Ironforge guards", prompt: "A dwarf guard." });
    // Observations are a judge's, not the reviewer's: only the reviewer's own words go as notes.
    expect(call.notes).toEqual(["accent too weak"]);
    expect(call.numbers).toMatch(/\| F0, mean pitch \(Hz\) \| 89 \| 110 \| 136 \|/);
    expect(call.numbers).toContain("v4 / live take: 1.25");
    expect(call.image?.toString()).toBe("png");
  });

  it("asks Claude with the numbers alone when the picture could not be drawn", async () => {
    const d = deps({ view: async () => null });
    expect(await differenceFromLive({ ...input, by: "claude" }, d)).toMatchObject({ by: "claude", image: null });
    expect(vi.mocked(d.describeClaude).mock.calls[0][0].image).toBeNull();
  });

  it("asks nothing of Claude when there is neither picture nor numbers, or no reference clip", async () => {
    const blind = deps({ view: async () => null, measure: async () => null });
    await expect(differenceFromLive({ ...input, by: "claude" }, blind)).rejects.toThrow(/picture and measurements/);
    const noReference = deps({ reference: async () => null });
    await expect(differenceFromLive({ ...input, by: "claude" }, noReference)).rejects.toThrow(/reference clip/);
    for (const d of [blind, noReference]) expect(d.describeClaude).not.toHaveBeenCalled();
  });

  it("asks nothing when a line has no live take", async () => {
    const d = deps({ live: async () => null });
    await expect(differenceFromLive(input, d)).rejects.toThrow(/no live take/);
    await expect(differenceFromLive({ ...input, by: "claude" }, d)).rejects.toThrow(/no live take/);
    expect(d.describe).not.toHaveBeenCalled();
    expect(d.describeClaude).not.toHaveBeenCalled();
  });

  it("refuses a line the version does not have", async () => {
    await expect(differenceFromLive({ ...input, position: 5 }, deps())).rejects.toThrow(/no sample line 6/);
  });
});
