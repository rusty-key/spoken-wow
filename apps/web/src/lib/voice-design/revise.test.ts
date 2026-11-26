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
    revise: vi.fn(async () => ({ heard: "h", prompt: "p", preview_text: "t" })),
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

  it("revises a version nobody has reviewed yet, from its siblings' notes", async () => {
    const d = deps(design("troll-male-dark", 1, []));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(d.revise).toHaveBeenCalledWith(expect.objectContaining({ status: "not reviewed yet", note: "" }));
  });

  it("refuses a good version, one without sample lines, and a slot without a game clip, before asking Gemini", async () => {
    const good = deps(design("troll-male-dark", 1, [review("good", "")]));
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, good)).rejects.toThrow(/good/);
    const unsampled = deps(design("troll-male-dark", 1, [], { samples: [] }));
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, unsampled)).rejects.toThrow(/sample lines first/);
    const noClip = deps(ALL[0], { reference: async () => null });
    await expect(reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, noClip)).rejects.toThrow(/game clip/);
    for (const d of [good, unsampled, noClip]) expect(d.revise).not.toHaveBeenCalled();
  });
});
