import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { analyseGroup } = await import("./analyse");
import type { AnalyseDeps } from "./analyse";
import type { GeminiResult } from "./types";

const voice = { voice_design_prompt: "p", preview_text: "t".repeat(120) };

function deps(over: Partial<AnalyseDeps> = {}): AnalyseDeps {
  return {
    slotsOf: async () => ["orc-male-guard", "orc-male-shady", "orc-male-standard"],
    gameClip: async (slot) => (slot === "orc-male-standard" ? null : Buffer.from(slot)),
    npcsOf: async (slot) => (slot === "orc-male-shady" ? ["Ulathek"] : ["Grunt"]),
    measure: async (clips) => clips.map((_, i) => ({ f0Hz: 100 + i }) as never),
    compare: vi.fn(async ({ clips }: { clips: { label: string }[] }): Promise<GeminiResult> => ({ voices: Object.fromEntries(clips.map((c) => [c.label, voice])) })),
    save: vi.fn(async (input) => ({ ...input, id: "a-1", createdAt: "now", createdByName: null })),
    random: () => 0,
    ...over,
  };
}

describe("analyseGroup", () => {
  it("compares the flavors with clips blind, and says which had none", async () => {
    const d = deps();
    const { analysis, missing } = await analyseGroup({ lang: "enUS", group: "orc-male", userId: "u", apiKey: "k" }, d);
    expect(missing).toEqual(["orc-male-standard"]);
    expect(Object.values(analysis.labels).sort()).toEqual(["orc-male-guard", "orc-male-shady"]);
    const sent = vi.mocked(d.compare).mock.calls[0][0];
    // The audio under each letter is that letter's slot's clip.
    for (const clip of sent.clips) expect(clip.audio.toString()).toBe(analysis.labels[clip.label]);
    expect(sent.prompt).toContain("Ulathek");
    expect(sent.prompt).not.toContain("shady");
    expect(analysis.measurements).toEqual({
      [sent.clips[0].label]: { f0Hz: 100 },
      [sent.clips[1].label]: { f0Hz: 101 },
    });
  });

  it("needs two flavors with clips to compare", async () => {
    const d = deps({ gameClip: async (slot) => (slot === "orc-male-guard" ? Buffer.from("g") : null) });
    await expect(analyseGroup({ lang: "enUS", group: "orc-male", userId: "u", apiKey: "k" }, d)).rejects.toThrow(/two/);
    expect(d.compare).not.toHaveBeenCalled();
  });

  it("stores nothing when Gemini fails", async () => {
    const d = deps({ compare: vi.fn(async () => Promise.reject(new Error("Gemini did not answer in JSON"))) });
    await expect(analyseGroup({ lang: "enUS", group: "orc-male", userId: "u", apiKey: "k" }, d)).rejects.toThrow(/JSON/);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("works without measurements", async () => {
    const { analysis } = await analyseGroup({ lang: "enUS", group: "orc-male", userId: "u", apiKey: "k" }, deps({ measure: async () => null }));
    expect(analysis.measurements).toBeNull();
  });
});
