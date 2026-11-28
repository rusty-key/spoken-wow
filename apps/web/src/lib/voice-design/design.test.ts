import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deleteDesignVoice, designAndRemixVersion, designVersion, remixVersion, retireOlder, saveDesignVoice } = await import("./design");
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
  playersHearOlderLines: false,
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

  it("lets the holder save another preview in place of the saved one", async () => {
    const d = deps({ voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", chosenPreview: 0, holderId: "u1", holderName: "Ann" });
    await saveDesignVoice({ ...base, id: "d1", preview: 2 }, d);
    expect(d.deleteVoice).toHaveBeenCalledWith("voice-9", "k");
    expect(vi.mocked(d.deleteVoice).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(d.createVoice).mock.invocationCallOrder[0]);
    expect(d.createVoice).toHaveBeenCalledWith({ name: "design-orc-male-shady-v3", prompt: DESIGN.prompt, generatedVoiceId: "g2" }, "k");
    expect(d.save).toHaveBeenCalledWith("enUS", "d1", { chosenPreview: 2, voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", holderId: "u1" });
  });

  it("keeps the saved voice when the same preview is saved again, or the version is shown to players", async () => {
    const saved = { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", chosenPreview: 0, holderId: "u1", holderName: "Ann" };
    const same = deps(saved);
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 0 }, same)).rejects.toThrow(/already/);
    const shown = deps({ ...saved, isPublic: true });
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 1 }, shown)).rejects.toThrow(/Players hear/);
    for (const d of [same, shown]) expect(d.deleteVoice).not.toHaveBeenCalled();
  });

  it("never replaces a voice that has been adopted into a slot", async () => {
    const d = deps(
      { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", chosenPreview: 0, holderId: "u1" },
      { accountVoices: vi.fn(async () => [{ voiceId: "voice-9", name: "orc-male-shady", category: "generated" }]) },
    );
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 1 }, d)).rejects.toThrow(/orc-male-shady/);
    expect(d.deleteVoice).not.toHaveBeenCalled();
    expect(d.createVoice).not.toHaveBeenCalled();
  });

  it("deletes the new voice and counts the old one deleted when the save fails after a replace", async () => {
    const d = deps(
      { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", chosenPreview: 0, holderId: "u1" },
      {
        createVoice: vi.fn(async () => "voice-10"),
        save: vi.fn(async () => Promise.reject(new Error("Players hear this version"))),
        markDeleted: vi.fn(async () => Promise.reject(new Error("db down"))),
      },
    );
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 1 }, d)).rejects.toThrow(/Players hear/);
    expect(d.deleteVoice).toHaveBeenCalledWith("voice-10", "k");
    expect(d.markDeleted).toHaveBeenCalledWith("enUS", "d1");
  });

  it("counts the old voice as deleted when its replacement fails", async () => {
    const d = deps(
      { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", chosenPreview: 0, holderId: "u1" },
      { createVoice: vi.fn(async () => Promise.reject(new Error("quota"))) },
    );
    await expect(saveDesignVoice({ ...base, id: "d1", preview: 1 }, d)).rejects.toThrow(/quota/);
    expect(d.markDeleted).toHaveBeenCalledWith("enUS", "d1");
    expect(d.save).not.toHaveBeenCalled();
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

  it("runs once a version is designed or remixed, and hands back what it freed", async () => {
    const parent = held(3);
    const d = deps(parent, {
      create: vi.fn(async (input) => ({ ...DESIGN, ...input, id: "d4", version: 4 })),
      slotDesigns: vi.fn(async () => [{ ...DESIGN, id: "d4", version: 4 }, parent]),
      accountVoices: vi.fn(async () => [{ voiceId: "voice-3", name: "design-orc-male-shady-v3", category: "generated" }]),
    });
    const designed = await designVersion({ ...base, slot: "orc-male-shady", prompt: DESIGN.prompt, previewText: DESIGN.previewText, analysisId: null }, d);
    expect(designed.retired.map((v) => v.id)).toEqual(["d3"]);
    const remixed = await remixVersion({ ...base, id: "d3", changes: "Colder.", prompt: DESIGN.prompt, previewText: DESIGN.previewText, settings: { promptStrength: 0.5, guidanceScale: null, loudness: null, seed: null } }, d);
    expect(remixed.design.id).toBe("d4");
    expect(d.deleteVoice).toHaveBeenCalledWith("voice-3", "k");
  });

  it("never fails the paid-for version, even when the slot cannot be read", async () => {
    const d = deps({}, { slotDesigns: vi.fn(async () => Promise.reject(new Error("connection lost"))) });
    await expect(retireOlder({ ...base, kept: DESIGN }, d)).resolves.toEqual([]);
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

describe("designAndRemixVersion", () => {
  const saved = { voiceId: "voice-9", voiceName: "design-orc-male-shady-v3", holderId: "u1", holderName: "Ann" };
  const settings = { promptStrength: 0.3, guidanceScale: null, loudness: null, seed: null };
  const both = { ...base, id: "d1", changes: "Colder.", prompt: "A cold orc, a back-alley dealer.", previewText: "x".repeat(120), settings };
  const remixed = [0, 1, 2].map((n) => ({ generatedVoiceId: `r${n}`, audio: Buffer.from(`r${n}`) }));

  it("keeps Voice Design's previews, then Voice Remix's, in one version", async () => {
    const d = deps(saved, { remix: vi.fn(async () => remixed) });
    await designAndRemixVersion(both, d);
    expect(d.design).toHaveBeenCalledWith({ prompt: withEnding("A cold orc, a back-alley dealer."), text: "x".repeat(120) }, "k");
    expect(d.remix).toHaveBeenCalledWith({ voiceId: "voice-9", changes: "Colder.", text: "x".repeat(120), ...settings }, "k");
    const input = vi.mocked(d.create).mock.calls[0][0];
    expect(input.previews.map((p) => p.generatedVoiceId)).toEqual(["g0", "g1", "g2", "r0", "r1", "r2"]);
    expect(input.analysis).toEqual({ remix_of: 3, remix_changes: "Colder.", remix_settings: settings, remix_from: 3 });
  });

  it("keeps the previews one call paid for when the other fails, and says which failed", async () => {
    const d = deps(saved, { remix: vi.fn(async () => Promise.reject(new Error("remix down"))) });
    await designAndRemixVersion(both, d);
    const input = vi.mocked(d.create).mock.calls[0][0];
    expect(input.previews.map((p) => p.generatedVoiceId)).toEqual(["g0", "g1", "g2"]);
    expect(input.analysis).toEqual({ made_problem: expect.stringMatching(/Voice Remix failed.*remix down/) });

    const noDesign = deps(saved, { design: vi.fn(async () => Promise.reject(new Error("design down"))), remix: vi.fn(async () => remixed) });
    await designAndRemixVersion(both, noDesign);
    expect(vi.mocked(noDesign.create).mock.calls[0][0].analysis).toMatchObject({
      remix_of: 3,
      remix_from: 0,
      made_problem: expect.stringMatching(/Voice Design failed.*design down/),
    });
  });

  it("makes no version when both fail", async () => {
    const d = deps(saved, { design: vi.fn(async () => Promise.reject(new Error("design down"))), remix: vi.fn(async () => Promise.reject(new Error("remix down"))) });
    await expect(designAndRemixVersion(both, d)).rejects.toThrow("design down");
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses anyone but the holder before anything is spent", async () => {
    const d = deps({ ...saved, holderId: "u2" });
    await expect(designAndRemixVersion(both, d)).rejects.toThrow(/Ann's ElevenLabs account/);
    expect(d.design).not.toHaveBeenCalled();
    expect(d.remix).not.toHaveBeenCalled();
  });
});
