import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sampleDesign } = await import("./sample");
import type { CorpusLine } from "@/lib/corpus";
import type { SampleDeps } from "./sample";
import type { Design } from "./types";

const SLOT = "orc-male-shady";
const line = (lineId: string, text: string, voice = SLOT) =>
  ({ lineId, text, voice, npcName: "Ulathek", generatable: true, playerGender: null }) as CorpusLine;
const LINES = [
  line("q:1:accept", "A long quest text about demons and debts."),
  line("f:1:orc-male-shady", "You dog! Now I'll trap your soul!"),
  line("g:abc", "What do you want? Speak quickly."),
  line("q:2:accept", "Guard this gate.", "orc-male-guard"),
];

const DESIGN = {
  id: "d1",
  slot: SLOT,
  version: 2,
  voiceId: "voice-9",
  voiceDeletedAt: null,
  holderId: "u1",
  holderName: "Ann",
  samples: [] as Design["samples"],
} as Design;

function deps(design: Partial<Design> = {}): SampleDeps {
  return {
    read: vi.fn(async () => ({ ...DESIGN, ...design })),
    lines: async () => LINES,
    shaper: async (_lang, _settings, direction) => (l) => `${direction ? `${direction} ` : ""}[gruff] ${l.text}`,
    settings: async () => ({ modelId: "eleven_v4", voiceSettings: { stability: 0.4 } }) as never,
    speak: vi.fn(async ({ text }) => ({
      ok: true as const,
      audio: Buffer.from(text),
      leadIn: false,
      leadInSec: null,
      credits: 7,
      costUsd: null,
      words: null,
      made: {} as never,
    })),
    keepAudio: async (data) => data.length.toString(16).padStart(64, "0"),
    replace: vi.fn(async () => {}),
    lock: (_id, work) => work(),
  };
}

const input = { lang: "enUS" as const, id: "d1", userId: "u1", apiKey: "k" };

describe("sampleDesign", () => {
  it("voices the default lines in the version's voice, shaped as regeneration would, with the caller's model", async () => {
    const d = deps();
    await sampleDesign(input, d);
    expect(vi.mocked(d.speak).mock.calls.map(([call]) => [call.voiceId, call.settings.modelId])).toEqual([
      ["voice-9", "eleven_v4"],
      ["voice-9", "eleven_v4"],
      ["voice-9", "eleven_v4"],
    ]);
    const [, , samples, made] = vi.mocked(d.replace).mock.calls[0];
    expect(samples.map((s) => s.lineId).sort()).toEqual(["f:1:orc-male-shady", "g:abc", "q:1:accept"]);
    expect(samples[0].text.startsWith("[gruff] ")).toBe(true);
    expect(samples[0]).toMatchObject({ credits: 7, npcName: "Ulathek" });
    expect(made).toEqual({ model: "eleven_v4", settings: { stability: 0.4 } });
  });

  it("adds the direction asked for to every line", async () => {
    const d = deps();
    await sampleDesign({ ...input, direction: "[thick Scottish accent]" }, d);
    const [, , samples] = vi.mocked(d.replace).mock.calls[0];
    expect(samples.every((s) => s.text.startsWith("[thick Scottish accent] [gruff] "))).toBe(true);
  });

  it("voices the lines last voiced again, topped up to three", async () => {
    const d = deps({ samples: [{ lineId: "g:abc" }, { lineId: "q:1:accept" }] as Design["samples"] });
    await sampleDesign(input, d);
    const [, , samples] = vi.mocked(d.replace).mock.calls[0];
    expect(samples.map((s) => s.lineId)).toEqual(["g:abc", "q:1:accept", "f:1:orc-male-shady"]);
  });

  it("picks other lines when asked, and keeps the old ones only to make up three", async () => {
    const more = [...LINES, line("g:def", "Another gossip line, a fresh one."), line("q:3:accept", "Another quest text.")];
    const d = { ...deps({ samples: [{ lineId: "g:abc" }, { lineId: "q:1:accept" }, { lineId: "f:1:orc-male-shady" }] as Design["samples"] }), lines: async () => more };
    await sampleDesign({ ...input, lines: "other" }, d);
    const [, , samples] = vi.mocked(d.replace).mock.calls[0];
    const ids = samples.map((s) => s.lineId);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(["g:def", "q:3:accept"]));
  });

  it("is the holder's alone, and spends nothing for anybody else", async () => {
    const d = deps({ holderId: "u2", holderName: "Bo" });
    await expect(sampleDesign(input, d)).rejects.toThrow(/Bo's ElevenLabs account/);
    expect(d.speak).not.toHaveBeenCalled();
  });

  it("refuses a second run on the same version before spending", async () => {
    const d = { ...deps(), lock: async () => Promise.reject(new Error("someone is already working on this version")) };
    await expect(sampleDesign(input, d)).rejects.toThrow(/already working/);
    expect(d.speak).not.toHaveBeenCalled();
  });

  it("needs a saved voice", async () => {
    const d = deps({ voiceId: null, holderId: null });
    await expect(sampleDesign(input, d)).rejects.toThrow(/no voice/);
  });
});
