import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deleteDesignVoice, designVersion, remixVersion, retireOlder, saveDesignVoice } = await import("./design");
const { designName, PROMPT_ENDING, withEnding } = await import("./limits");
import type { DesignDeps } from "./design";
import type { Design } from "./types";

const DESIGN: Design = {
  id: "d1",
  lang: "enUS",
  slot: "orc-male-shady",
  version: 3,
  prompt: "A gruff orc, a back-alley dealer.",
  previewText: "x".repeat(120),
  previews: [0, 1, 2].map((n) => ({ generatedVoiceId: `g${n}`, sha256: String(n).repeat(64), measures: null })),
  chosenPreview: null,
  voiceId: null,
  voiceName: null,
  holderId: null,
  holderName: null,
  voiceDeletedAt: null,
  sampleModel: null,
  analysisId: null,
  note: null,
  analysis: null,
  samples: [],
  sampledAt: null,
  isPublic: false,
  showings: [],
  reviews: [],
  createdBy: "u1",
  createdByName: "Ann",
  createdAt: "now",
};

function deps(design: Partial<Design> = {}, over: Partial<DesignDeps> = {}): DesignDeps {
  const current = { ...DESIGN, ...design };
  return {
    isSlot: async (slot) => slot.startsWith("orc-male"),
    isOwnAnalysis: async (_lang, id) => id === "a-own",
    design: vi.fn(async () => [
      { generatedVoiceId: "g0", audio: Buffer.from("a") },
      { generatedVoiceId: "g1", audio: Buffer.from("b") },
      { generatedVoiceId: "g2", audio: Buffer.from("c") },
    ]),
    remix: vi.fn(async () => [{ generatedVoiceId: "r0", audio: Buffer.from("r") }]),
    keepAudio: vi.fn(async (data: Buffer) => data.toString().repeat(64)),
    measure: vi.fn(async (clips: Buffer[]) => clips.map((_, i) => ({ f0Hz: 100 - i }) as never)),
    create: vi.fn(async (input) => ({ ...current, ...input, version: 1 })),
    read: vi.fn(async () => current),
    slotDesigns: vi.fn(async () => [current]),
    save: vi.fn(async () => {}),
    createVoice: vi.fn(async () => "voice-9"),
    accountVoices: vi.fn(async () => [{ voiceId: "voice-9", name: "design-orc-male-shady-v3", category: "generated" }]),
    deleteVoice: vi.fn(async () => {}),
    markDeleted: vi.fn(async () => {}),
    lock: (_id, work) => work(),
    ...over,
  };
}

const base = { lang: "enUS" as const, userId: "u1", apiKey: "k" };

describe("designVersion", () => {
  it("keeps and measures every preview", async () => {
    const d = deps();
    await designVersion({ ...base, slot: "orc-male-shady", prompt: DESIGN.prompt, previewText: DESIGN.previewText, analysisId: null }, d);
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: "orc-male-shady",
        previews: [
          { generatedVoiceId: "g0", sha256: "a".repeat(64), measures: { f0Hz: 100 } },
          { generatedVoiceId: "g1", sha256: "b".repeat(64), measures: { f0Hz: 99 } },
          { generatedVoiceId: "g2", sha256: "c".repeat(64), measures: { f0Hz: 98 } },
        ],
      }),
    );
  });

  it("sends every prompt with the ending that keeps s sounds soft, replacing the old one", async () => {
    const d = deps();
    const old = "A gruff orc, a back-alley dealer. Perfect audio quality, dry close-mic studio recording, no reverb or effects.";
    await designVersion({ ...base, slot: "orc-male-shady", prompt: old, previewText: DESIGN.previewText, analysisId: null }, d);
    expect(vi.mocked(d.design).mock.calls[0][0].prompt).toBe(`A gruff orc, a back-alley dealer. ${PROMPT_ENDING}`);
  });

  it("keeps who the voice is for and what Gemini heard on a revised version, within bounds", async () => {
    const d = deps();
    await designVersion(
      { ...base, slot: "orc-male-shady", prompt: DESIGN.prompt, previewText: DESIGN.previewText, analysisId: null, revisionHeard: "x".repeat(5000), archetype: "Shady dealer" },
      d,
    );
    const analysis = vi.mocked(d.create).mock.calls[0][0].analysis as Record<string, string>;
    expect(analysis.archetype).toBe("Shady dealer");
    expect(analysis.revision_heard).toHaveLength(1000);
  });

  it("still refuses an empty prompt", async () => {
    const d = deps();
    await expect(designVersion({ ...base, slot: "orc-male-shady", prompt: "  ", previewText: DESIGN.previewText, analysisId: null }, d)).rejects.toThrow(/prompt/);
  });

  it("refuses a preview text Voice Design would refuse, before spending", async () => {
    const d = deps();
    await expect(
      designVersion({ ...base, slot: "orc-male-shady", prompt: DESIGN.prompt, previewText: "Too short.", analysisId: null }, d),
    ).rejects.toThrow(/100/);
    expect(d.design).not.toHaveBeenCalled();
  });

  it("refuses an analysis that is not the team's own, before spending", async () => {
    const d = deps();
    await expect(
      designVersion({ ...base, slot: "orc-male-shady", prompt: DESIGN.prompt, previewText: DESIGN.previewText, analysisId: "a-theirs" }, d),
    ).rejects.toThrow(/analysis/);
    expect(d.design).not.toHaveBeenCalled();
  });

  it("refuses a slot not on the roster", async () => {
    const d = deps();
    await expect(
      designVersion({ ...base, slot: "elf-male-x", prompt: DESIGN.prompt, previewText: DESIGN.previewText, analysisId: null }, d),
    ).rejects.toThrow(/slot/);
    expect(d.design).not.toHaveBeenCalled();
  });
});

describe("saveDesignVoice", () => {
  it("saves the chosen preview as design-<slot>-v<n> in the caller's account", async () => {
    const d = deps();
    await saveDesignVoice({ ...base, id: "d1", preview: 1 }, d);
    expect(designName(DESIGN)).toBe("design-orc-male-shady-v3");
    expect(d.createVoice).toHaveBeenCalledWith({ name: "design-orc-male-shady-v3", prompt: DESIGN.prompt, generatedVoiceId: "g1" }, "k");
    expect(d.save).toHaveBeenCalledWith("enUS", "d1", { chosenPreview: 1, voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", holderId: "u1" });
  });

  it("saves a version once", async () => {
    const d = deps({ voiceId: "voice-1", holderId: "u2", holderName: "Bo" });
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 0 }, d)).rejects.toThrow(/already/);
    expect(d.createVoice).not.toHaveBeenCalled();
  });

  it("saves again once the voice is deleted from ElevenLabs", async () => {
    const d = deps({ voiceId: "voice-1", holderId: "u2", voiceDeletedAt: "2026-11-26T00:00:00Z" });
    await saveDesignVoice({ ...base, id: "d1", preview: 2 }, d);
    expect(d.createVoice).toHaveBeenCalledWith(expect.objectContaining({ generatedVoiceId: "g2" }), "k");
  });

  it("refuses a preview the version does not have", async () => {
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 3 }, deps())).rejects.toThrow(/preview/);
  });
});

describe("a busy version", () => {
  it("refuses a second save before anything is spent", async () => {
    const d = deps({}, { lock: async () => Promise.reject(new Error("someone is already working on this version")) });
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 0 }, d)).rejects.toThrow(/already working/);
    expect(d.createVoice).not.toHaveBeenCalled();
  });
});

describe("deleteDesignVoice", () => {
  const saved = { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", holderId: "u1", holderName: "Ann" };

  it("deletes the voice from the holder's account and keeps the audio", async () => {
    const d = deps(saved);
    await deleteDesignVoice({ ...base, id: "d1" }, d);
    expect(d.deleteVoice).toHaveBeenCalledWith("voice-9", "k");
    expect(d.markDeleted).toHaveBeenCalledWith("enUS", "d1");
  });

  it("is the holder's alone, and says whose account it is in", async () => {
    const d = deps({ ...saved, holderId: "u2", holderName: "Bo" });
    await expect(deleteDesignVoice({ ...base, id: "d1" }, d)).rejects.toThrow(/Bo/);
    expect(d.accountVoices).not.toHaveBeenCalled();
    expect(d.deleteVoice).not.toHaveBeenCalled();
  });

  it("never deletes a voice that has been adopted into a slot", async () => {
    const d = deps(saved, { accountVoices: vi.fn(async () => [{ voiceId: "voice-9", name: "orc-male-shady", category: "generated" }]) });
    await expect(deleteDesignVoice({ ...base, id: "d1" }, d)).rejects.toThrow(/orc-male-shady/);
    expect(d.deleteVoice).not.toHaveBeenCalled();
  });

  it("counts a voice already gone from the account as deleted", async () => {
    const d = deps(saved, { accountVoices: vi.fn(async () => []) });
    await deleteDesignVoice({ ...base, id: "d1" }, d);
    expect(d.deleteVoice).not.toHaveBeenCalled();
    expect(d.markDeleted).toHaveBeenCalled();
  });
});

describe("retireOlder", () => {
  const held = (version: number, holderId = "u1"): Design => ({
    ...DESIGN,
    id: `d${version}`,
    version,
    voiceId: `voice-${version}`,
    voiceName: `design-orc-male-shady-v${version}`,
    holderId,
    holderName: holderId === "u1" ? "Ann" : "Bo",
  });

  it("deletes every older version's voice the caller holds, and leaves the rest", async () => {
    const versions = [{ ...DESIGN, id: "d4", version: 4 }, held(3), held(2, "u2"), { ...held(1), voiceDeletedAt: "then" }];
    const d = deps({}, {
      slotDesigns: vi.fn(async () => versions),
      read: vi.fn(async (_lang, id) => versions.find((v) => v.id === id)!),
      accountVoices: vi.fn(async () => [{ voiceId: "voice-3", name: "design-orc-male-shady-v3", category: "generated" }]),
    });
    const retired = await retireOlder({ ...base, kept: versions[0] }, d);
    expect(d.deleteVoice).toHaveBeenCalledTimes(1);
    expect(d.deleteVoice).toHaveBeenCalledWith("voice-3", "k");
    expect(d.markDeleted).toHaveBeenCalledWith("enUS", "d3");
    expect(retired.map((v) => v.id)).toEqual(["d3"]);
  });

  it("keeps a voice adopted on /voices, and a newer version made meanwhile, without failing", async () => {
    const versions = [held(5), { ...DESIGN, id: "d4", version: 4 }, held(3)];
    const d = deps({}, {
      slotDesigns: vi.fn(async () => versions),
      read: vi.fn(async (_lang, id) => versions.find((v) => v.id === id)!),
      accountVoices: vi.fn(async () => [{ voiceId: "voice-3", name: "orc-male-shady", category: "generated" }]),
    });
    await expect(retireOlder({ ...base, kept: versions[1] }, d)).resolves.toEqual([]);
    expect(d.deleteVoice).not.toHaveBeenCalled();
  });
});

describe("remixVersion", () => {
  const saved = { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", holderId: "u1", holderName: "Ann", analysis: { archetype: "Back-alley dealer" } };
  const settings = { promptStrength: 0.3, guidanceScale: null, loudness: null, seed: 4 };
  const remix = { ...base, id: "d1", changes: "  Add a thick Scottish accent.  ", prompt: "A gruff orc with a thick Scottish accent.", previewText: "x".repeat(120), settings };

  it("remixes the holder's voice with only the changes, and keeps the whole new prompt as the version's", async () => {
    const d = deps(saved);
    await remixVersion(remix, d);
    expect(d.remix).toHaveBeenCalledWith({ voiceId: "voice-9", changes: "Add a thick Scottish accent.", text: "x".repeat(120), ...settings }, "k");
    expect(d.design).not.toHaveBeenCalled();
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: DESIGN.slot,
        prompt: withEnding("A gruff orc with a thick Scottish accent."),
        previews: [{ generatedVoiceId: "r0", sha256: "r".repeat(64), measures: { f0Hz: 100 } }],
        analysis: { archetype: "Back-alley dealer", remix_of: 3, remix_changes: "Add a thick Scottish accent.", remix_settings: settings },
      }),
    );
  });

  it("keeps the archetype Gemini gave with the changes over the parent's", async () => {
    const d = deps(saved);
    await remixVersion({ ...remix, archetype: "City guard" }, d);
    expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ analysis: expect.objectContaining({ archetype: "City guard" }) }));
  });

  it("refuses anyone but the holder, a deleted voice, and empty changes, before anything is spent", async () => {
    const other = deps({ ...saved, holderId: "u2" });
    await expect(remixVersion(remix, other)).rejects.toThrow(/Ann's ElevenLabs account/);
    const deleted = deps({ ...saved, voiceDeletedAt: "2026-11-26T00:00:00Z" });
    await expect(remixVersion(remix, deleted)).rejects.toThrow(/no voice/);
    const empty = deps(saved);
    await expect(remixVersion({ ...remix, changes: " " }, empty)).rejects.toThrow(/changes/);
    for (const d of [other, deleted, empty]) expect(d.remix).not.toHaveBeenCalled();
  });
});
