import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { reviseDesign, siblingNotes, slotHistory } = await import("./revise");
const { buildRevisePrompt } = await import("./gemini");
import type { CorpusLine } from "@/lib/corpus";
import type { ReviseDeps } from "./revise";
import type { Design, Observation, PlayerNote } from "./types";

const review = (status: "good" | "needs-work", note: string, extra: { players?: PlayerNote[]; observations?: Observation[] } = {}) => ({
  id: 1,
  status,
  note,
  players: extra.players ?? [],
  observations: extra.observations ?? [],
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
    prompt: `prompt ${slot} v${version}`,
    previewText: "preview",
    reviews,
    samples: [{ position: 0, sha256: "a".repeat(64), lineId: "q:1", text: "Victory for the Sin'dorei.", npcName: null, characters: 1, credits: 1 }],
    analysis: { archetype: "Witch doctor" },
    ...extra,
  }) as Design;

// Newest version first within a slot, as listDesigns returns them.
const ALL = [
  design("troll-male-dark", 1, [review("needs-work", "No accent at all")]),
  design("troll-male-shaman", 2, [review("needs-work", "")]),
  design("troll-male-shaman", 1, [review("needs-work", "Trolls need a Jamaican accent")]),
  design("troll-female-old", 1, [review("good", "Too slow, but lovely")]),
  design("orc-male-guard", 1, [review("needs-work", "Too wise")]),
];

function deps(target: Design, over: Partial<ReviseDeps> = {}, all: Design[] = ALL): ReviseDeps {
  return {
    read: async () => target,
    all: async () => all,
    reference: async () => Buffer.from("ref"),
    audio: async () => Buffer.from("smp"),
    line: async (_lang, lineId) => ({ lineId }) as CorpusLine,
    live: async () => Buffer.from("live"),
    measure: vi.fn(async (clips: Buffer[]) => clips.map((_, i) => ({ f0Hz: 100 + i, durationSec: 4 + i }))),
    analysis: async () => ({ labels: { B: "troll-male-dark" }, result: { voices: { B: { archetype: "Shady rogue", voice_design_prompt: "", preview_text: "" } } } }) as never,
    revise: vi.fn(async () => ({ heard: "h", prompt: "p", preview_text: "t", changes: "c" })),
    ...over,
  };
}

const sent = (d: ReviseDeps) => vi.mocked(d.revise).mock.calls[0][0];
const promptOf = (d: ReviseDeps) => buildRevisePrompt({ ...sent(d), hasLive: sent(d).live !== null });

describe("siblingNotes", () => {
  it("passes each other flavor of the race its newest note, labelled with its slot, and nothing from other races", () => {
    expect(siblingNotes(ALL, "troll-male-dark")).toEqual([
      { slot: "troll-male-shaman", version: 1, note: "Trolls need a Jamaican accent" },
      { slot: "troll-female-old", version: 1, note: "Too slow, but lovely" },
    ]);
  });

  it("labels each sibling note and says only race-wide points carry over", async () => {
    const d = deps(ALL[0]);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    const text = promptOf(d);
    expect(text).toContain('- troll-male-shaman v1: "Trolls need a Jamaican accent"');
    expect(text).toContain('- troll-female-old v1: "Too slow, but lovely"');
    expect(text).toMatch(/only race-wide points \(the accent[^)]*\) apply to troll-male-dark/);
    expect(text).toMatch(/Slot-specific points \([^)]*"too slow"\) do not transfer/);
  });
});

describe("the bloodelf case: an observation is never the instruction", () => {
  // bloodelf-female v3 in production: the admin's wish, then What's different's note added to the review.
  const v3 = design("bloodelf-female", 3, [
    review("needs-work", "Should be faster, much more assertive and dominant. It's a Dark Lady of the undead, the ruler"),
    review("needs-work", "faster, less breathy, more energy", {
      observations: [{ by: "gemini", note: "slower pace and breathier texture with lower energy" }],
    }),
  ]);
  const all = [v3, design("bloodelf-female", 2, [review("needs-work", "too noble-sounding")]), design("bloodelf-female", 1, [])];

  it("sends the admin's earlier wish, and the observation as what v3 sounds like", async () => {
    const d = deps(v3, {}, all);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    const text = promptOf(d);
    expect(text).toContain(`Reviewer's note: "Should be faster, much more assertive and dominant. It's a Dark Lady of the undead, the ruler" [open]`);
    expect(text).toContain(`Reviewer's note: "faster, less breathy, more energy" [open]`);
    const observed = text.split("\n").filter((line) => line.includes("slower pace and breathier texture"));
    expect(observed).toEqual([
      `    Observation by Gemini, v3's take compared with the live take (how v3 sounds, NOT a wish): "slower pace and breathier texture with lower energy"`,
    ]);
    expect(text).not.toMatch(/Reviewer's note: "slower pace/);
    expect(text).toMatch(/never follow one as an instruction/);
  });

  it("reads an old note that is really an observation as weaker than the reviewer's wishes", async () => {
    // Rows from before observations were kept: the observation sits in the note itself.
    const legacy = design("bloodelf-female", 3, [
      review("needs-work", "Should be faster, much more assertive and dominant. It's a Dark Lady of the undead, the ruler"),
      review("needs-work", "slower pace and breathier texture with lower energy"),
    ]);
    const d = deps(legacy, {}, [legacy]);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    const text = promptOf(d);
    expect(text).toContain("Should be faster, much more assertive and dominant");
    expect(text).toMatch(/may be an observation pasted in as a note\. Where it contradicts the reviewer's own wishes, the wishes win/);
  });
});

describe("history", () => {
  // orc-male-shady in production: v1 "sounds female", v2 "noble and highstrung", v3 good, then on.
  const shady = [
    design("orc-male-shady", 5, [review("needs-work", "too slow now")]),
    design("orc-male-shady", 4, [review("needs-work", "too fast")]),
    design("orc-male-shady", 3, [review("good", "It's a bit too cartoony, but ok for now")]),
    design("orc-male-shady", 2, [review("needs-work", "Much worse, now it sounds noble and highstrung instead of gruff and shady")]),
    design("orc-male-shady", 1, [review("needs-work", "Overall sounds female")]),
  ];

  it("lists every version oldest first, each with the first later version marked good", () => {
    const history = slotHistory(shady, "orc-male-shady");
    expect(history.map((entry) => [entry.version, entry.satisfiedBy])).toEqual([
      [1, 3],
      [2, 3],
      [3, null],
      [4, null],
      [5, null],
    ]);
    expect(history[0].reviews[0].note).toBe("Overall sounds female");
  });

  it("leaves out versions after the one revised", async () => {
    const v4 = shady[1];
    const d = deps(v4, {}, shady);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(sent(d).history.map((entry) => entry.version)).toEqual([1, 2, 3, 4]);
  });

  it("sends every version's notes in order, marks the satisfied ones, and says the newer note wins", async () => {
    const d = deps(shady[0], {}, shady);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    const text = promptOf(d);
    const order = ["Overall sounds female", "noble and highstrung", "too cartoony", "too fast", "too slow now"].map((note) => text.indexOf(note));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
    expect(text).toContain(`"Overall sounds female" [satisfied: v3 was marked good]`);
    expect(text).toContain(`"too fast" [open]`);
    expect(text).toMatch(/When notes conflict, the newer note wins/);
    expect(text).toMatch(/Never reintroduce a problem an earlier note asked to fix/);
    expect(text).toMatch(/Satisfy every open note, from every version/);
  });
});

describe("reviseDesign", () => {
  it("hears the reference, the chosen line's live take and the line in the version, with their numbers", async () => {
    const d = deps(ALL[0]);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(sent(d)).toMatchObject({
      slot: "troll-male-dark",
      status: "needs-work",
      archetype: "Witch doctor",
      prompt: "prompt troll-male-dark v1",
      line: "Victory for the Sin'dorei.",
      reference: Buffer.from("ref"),
      live: Buffer.from("live"),
      sample: Buffer.from("smp"),
    });
    expect(vi.mocked(d.measure).mock.calls[0][0].map(String)).toEqual(["ref", "live", "smp"]);
    expect(sent(d).numbers).toContain("| F0, mean pitch (Hz) | 100 | 101 | 102 |");
  });

  it("still revises a line without a live take, and without the measuring helper", async () => {
    const d = deps(ALL[0], { live: async () => null, measure: async () => null });
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(sent(d)).toMatchObject({ live: null, numbers: "" });
    const noLive = deps(ALL[0], { live: async () => null });
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, noLive);
    expect(vi.mocked(noLive.measure).mock.calls[0][0].map(String)).toEqual(["ref", "smp"]);
    expect(sent(noLive).numbers).toContain("| F0, mean pitch (Hz) | 100 | - | 101 |");
  });

  it("reads who the voice is for from the blind comparison when the version has no description", async () => {
    const d = deps(design("troll-male-dark", 1, [], { analysis: null, analysisId: "a1" }));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(sent(d)).toMatchObject({ archetype: "Shady rogue" });
  });

  it("keeps the players' notes picked in the version's verdicts", async () => {
    const target = design("tauren-female", 1, [review("needs-work", "Deeper", { players: [{ verdict: "off", note: "Too soft." }] })]);
    const d = deps(target, {}, [target]);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(promptOf(d)).toContain(`Player's note the reviewer chose to act on [open]: "Doesn't fit: Too soft."`);
  });

  it("hands back who the voice is for, so the next version keeps it", async () => {
    const revision = await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, deps(ALL[0]));
    expect(revision.archetype).toBe("Witch doctor");
  });

  it("revises a version nobody has reviewed yet, from its siblings' notes", async () => {
    const d = deps(design("troll-male-dark", 1, []));
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, d);
    expect(sent(d)).toMatchObject({ status: "not reviewed yet" });
  });

  it("listens to the sample line the newest verdict marked off", async () => {
    const lines = [0, 1, 2].map((position) => ({ position, sha256: String(position).repeat(64), lineId: `q:${position}`, text: "t", npcName: null, characters: 1, credits: 1 }));
    const marked = { ...review("needs-work", "too noble"), clips: { "sample:0": "good" as const, "sample:2": "off" as const } };
    const audio = vi.fn(async () => Buffer.from("smp"));
    const line = vi.fn(async (_lang: string, lineId: string) => ({ lineId }) as CorpusLine);
    await reviseDesign({ lang: "enUS", id: "x", apiKey: "k" }, deps(design("troll-male-dark", 1, [marked], { samples: lines }), { audio, line }));
    expect(audio).toHaveBeenCalledWith("2".repeat(64), "enUS");
    expect(line).toHaveBeenCalledWith("enUS", "q:2");
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
