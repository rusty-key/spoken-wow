import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { reviseDesign, siblingNotes } = await import("./revise");
import type { ReviseDeps } from "./revise";
import type { Design } from "./types";

const review = (status: "good" | "needs-work", note: string) => ({
  id: 1,
  status,
  note,
  bestPreview: null,
  clips: {},
  createdBy: null,
  createdByName: null,
  createdAt: "2026-11-26T00:00:00Z",
});

const design = (slot: string, version: number, reviews: ReturnType<typeof review>[], extra: Partial<Design> = {}) =>
  ({
    id: `${slot}-${version}`,
    slot,
    version,
    prompt: `prompt ${slot}`,
    previewText: "preview",
    reviews,
    samples: [{ position: 0, sha256: "a".repeat(64), lineId: "q:1", text: "t", npcName: null, characters: 1, credits: 1 }],
    analysis: { archetype: "Witch doctor" },
    ...extra,
  }) as Design;

const ALL = [
  design("troll-male-dark", 1, [review("needs-work", "No accent at all")]),
  design("troll-male-shaman", 2, [review("needs-work", "")]),
  design("troll-male-shaman", 1, [review("needs-work", "Trolls need a Jamaican accent")]),
  design("troll-female-old", 1, [review("good", "Lovely")]),
  design("orc-male-guard", 1, [review("needs-work", "Too wise")]),
];

function deps(target: Design, over: Partial<ReviseDeps> = {}): ReviseDeps {
  return {
    read: async () => target,
    all: async () => ALL,
    reference: async () => Buffer.from("ref"),
    audio: async () => Buffer.from("smp"),
    analysis: async () => ({ labels: { B: "troll-male-dark" }, result: { voices: { B: { archetype: "Shady rogue", voice_design_prompt: "", preview_text: "" } } } }) as never,
    revise: vi.fn(async () => ({ heard: "h", prompt: "p", preview_text: "t", changes: "c" })),
    ...over,
  };
}

describe("siblingNotes", () => {
  it("passes each other flavor of the race its newest note, and nothing from other races", () => {
    expect(siblingNotes(ALL, "troll-male-dark")).toEqual({
      "troll-male-shaman": "Trolls need a Jamaican accent",
      "troll-female-old": "Lovely",
    });
  });
});

describe("reviseDesign", () => {
  it("sends the note, the siblings' notes, the old prompt and both recordings", async () => {
    const d = deps(ALL[0]);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(d.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: "troll-male-dark",
        status: "needs-work",
        note: "No accent at all",
        siblings: { "troll-male-shaman": "Trolls need a Jamaican accent", "troll-female-old": "Lovely" },
        archetype: "Witch doctor",
        prompt: "prompt troll-male-dark",
        reference: Buffer.from("ref"),
        sample: Buffer.from("smp"),
      }),
    );
  });

  it("reads who the voice is for from the blind comparison when the version has no description", async () => {
    const d = deps(design("troll-male-dark", 1, [], { analysis: null, analysisId: "a1" }));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(d.revise).toHaveBeenCalledWith(expect.objectContaining({ archetype: "Shady rogue" }));
  });

  it("sends the newest note on the version, even when the latest verdict has none", async () => {
    const d = deps(design("troll-male-dark", 3, [review("needs-work", "Accent too weak"), review("needs-work", "")]));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(d.revise).toHaveBeenCalledWith(expect.objectContaining({ note: "Accent too weak" }));
  });

  it("hands back who the voice is for, so the next version keeps it", async () => {
    const revision = await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, deps(ALL[0]));
    expect(revision.archetype).toBe("Witch doctor");
  });

  it("revises a version nobody has reviewed yet, from its siblings' notes", async () => {
    const d = deps(design("troll-male-dark", 1, []));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(d.revise).toHaveBeenCalledWith(expect.objectContaining({ status: "not reviewed yet", note: "" }));
  });

  it("listens to the sample line the newest verdict marked off", async () => {
    const lines = [0, 1, 2].map((position) => ({ position, sha256: String(position).repeat(64), lineId: `q:${position}`, text: "t", npcName: null, characters: 1, credits: 1 }));
    const marked = { ...review("needs-work", "too noble"), clips: { "sample:0": "good" as const, "sample:2": "off" as const } };
    const audio = vi.fn(async () => Buffer.from("smp"));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, deps(design("troll-male-dark", 1, [marked], { samples: lines }), { audio }));
    expect(audio).toHaveBeenCalledWith("2".repeat(64), "enUS");
  });

  it("ignores marks given before the lines were voiced again", async () => {
    const lines = [0, 1, 2].map((position) => ({ position, sha256: String(position).repeat(64), lineId: `q:${position}`, text: "t", npcName: null, characters: 1, credits: 1 }));
    const marked = { ...review("needs-work", "too noble"), clips: { "sample:2": "off" as const } };
    const audio = vi.fn(async () => Buffer.from("smp"));
    const resampled = design("troll-male-dark", 1, [marked], { samples: lines, sampledAt: "2026-11-27T00:00:00Z" });
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, deps(resampled, { audio }));
    expect(audio).toHaveBeenCalledWith("0".repeat(64), "enUS");
  });

  it("refuses a good version, one without sample lines, and a slot without a reference clip, before asking Gemini", async () => {
    const good = deps(design("troll-male-dark", 1, [review("good", "")]));
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, good)).rejects.toThrow(/good/);
    const unsampled = deps(design("troll-male-dark", 1, [], { samples: [] }));
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, unsampled)).rejects.toThrow(/sample lines first/);
    const noClip = deps(ALL[0], { reference: async () => null });
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, noClip)).rejects.toThrow(/reference clip/);
    for (const d of [good, unsampled, noClip]) expect(d.revise).not.toHaveBeenCalled();
  });
});

