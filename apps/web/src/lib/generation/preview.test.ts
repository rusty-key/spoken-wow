import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { CorpusLine } from "@/lib/corpus";
import {
  carrier,
  previewCache,
  previewKey,
  renderPreview,
  sampleSentence,
  sampleSentences,
  speakable,
  voicePicker,
  MAX_PREVIEW_CHARS,
} from "./preview";
import type { LexiconEntry } from "./lexicon";

const IPA: LexiconEntry = {
  grapheme: "Gnomeregan",
  ipa: "ˈnoʊmɹəɡæn",
  confidence: "high",
};

const ALIAS: LexiconEntry = { ...IPA, ipa: undefined, alias: "nomeregan" };

const CONFIG = {
  modelId: "eleven_v3",
  voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
  seedStrategy: "npc" as const,
  // A preview renders one word to check how it is said, not a race's line, so no accent
  // direction belongs on it.
  raceTags: {},
};

function line(text: string, over: Partial<CorpusLine> = {}): CorpusLine {
  return {
    lineId: "q:1:accept",
    source: "accept",
    questId: 1,
    questTitle: null,
    npcId: 1,
    npcName: "Eagan Peltskinner",
    npcType: "creature",
    race: "human",
    gender: "male",
    flavor: "standard",
    voice: "human-male-standard",
    playerGender: null,
    text,
    originalText: text,
    fileName: "x.mp3",
    generatable: true,
    skipReason: null,
    ...over,
  } as CorpusLine;
}

const temporary: string[] = [];
function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-preview-"));
  temporary.push(dir);
  return dir;
}
afterAll(() => temporary.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("sampleSentence", () => {
  /**
   * A real line beats an invented one: it is the actual context and the actual register, and
   * hearing the name where it will really appear is the whole question.
   */
  it("picks the shortest real sentence that uses the name", () => {
    const lines = [
      line("The long road to Gnomeregan is walked by fools and by heroes alike, friend."),
      line("Gnomeregan is lost."),
    ];
    expect(sampleSentence("Gnomeregan", lines).text).toBe("Gnomeregan is lost.");
  });

  it("reports which NPC the sentence came from", () => {
    const lines = [line("Gnomeregan is lost.", { npcName: "Nogg", lineId: "q:9:accept" })];
    expect(sampleSentence("Gnomeregan", lines).line?.npcName).toBe("Nogg");
  });

  // Matched the way the rule will match it, so the sentence a preview uses is a sentence the
  // rule would actually have fired on.
  it("matches case-insensitively and at word boundaries", () => {
    expect(sampleSentence("tauren", [line("The Tauren wait.")]).text).toBe("The Tauren wait.");
    expect(sampleSentence("Caer", [line("The Caern is near.")]).line).toBeNull();
  });

  // Quest text runs to a couple of thousand characters. Rendering one to hear a single word
  // would cost more than regenerating the line it came from.
  it("refuses a sentence longer than the cap", () => {
    const long = `Gnomeregan ${"x".repeat(MAX_PREVIEW_CHARS)}.`;
    expect(sampleSentence("Gnomeregan", [line(long)]).text).toBe(carrier("Gnomeregan"));
  });

  it("skips lines that are never voiced", () => {
    const lines = [line("Gnomeregan is lost.", { generatable: false, skipReason: "no text" })];
    expect(sampleSentence("Gnomeregan", lines).line).toBeNull();
  });

  it("falls back to a carrier sentence, not to the bare word", () => {
    const { text, line: source } = sampleSentence("Xyzzy", [line("Nothing here.")]);
    expect(source).toBeNull();
    expect(text).toContain("Xyzzy");
    // A bare name gets list intonation and a final fall, which is not how it will be said.
    expect(text.split(" ").length).toBeGreaterThan(3);
  });
});

describe("sampleSentences", () => {
  // The batch exists so the page can resolve all 134 at once; it must agree with the single
  // form, or a button would report a cache state for a sentence the preview never uses.
  it("agrees with sampleSentence, entry by entry", () => {
    const lines = [line("Gnomeregan is lost."), line("The Tauren wait.")];
    const batch = sampleSentences(["Gnomeregan", "tauren"], lines);

    expect(batch.get("Gnomeregan")).toEqual(sampleSentence("Gnomeregan", lines));
    expect(batch.get("tauren")).toEqual(sampleSentence("tauren", lines));
  });

  it("returns an entry for every name asked for, matched or not", () => {
    const batch = sampleSentences(["Gnomeregan", "Xyzzy"], [line("Gnomeregan is lost.")]);
    expect([...batch.keys()]).toEqual(["Gnomeregan", "Xyzzy"]);
    expect(batch.get("Xyzzy")?.line).toBeNull();
  });

  // The lower-cased `includes` before the regex is what makes one pass cheap. It must not
  // also make it wrong: a substring hit that fails the word boundary is still no match.
  it("does not let the prefilter smuggle in a substring match", () => {
    expect(sampleSentences(["Caer"], [line("The Caern is near.")]).get("Caer")?.line).toBeNull();
  });

  /**
   * The memo is keyed on the identity of the corpus it was built from. Without that, a name
   * looked up against one set of lines would keep answering for every later set - a wrong
   * answer rather than a stale one.
   */
  it("does not answer for one corpus from another", () => {
    expect(sampleSentences(["Gnomeregan"], [line("Gnomeregan is lost.")]).get("Gnomeregan")?.text)
      .toBe("Gnomeregan is lost.");
    expect(sampleSentences(["Gnomeregan"], [line("Gnomeregan has fallen.")]).get("Gnomeregan")?.text)
      .toBe("Gnomeregan has fallen.");
  });

  it("remembers within one corpus", () => {
    const lines = [line("Gnomeregan is lost.")];
    expect(sampleSentences(["Gnomeregan"], lines)).toEqual(sampleSentences(["Gnomeregan"], lines));
  });
});

describe("speakable", () => {
  /**
   * The trick the whole feature rests on: an inline phoneme tag is honoured by the same
   * models that honour a dictionary phoneme rule, so a draft can be heard before it is saved
   * and before any dictionary exists.
   */
  it("wraps IPA in an inline phoneme tag", () => {
    expect(speakable(IPA, "Gnomeregan is lost.")).toBe(
      '<phoneme alphabet="ipa" ph="ˈnoʊmɹəɡæn">Gnomeregan</phoneme> is lost.',
    );
  });

  it("substitutes a respelling outright, as an alias rule would", () => {
    expect(speakable(ALIAS, "Gnomeregan is lost.")).toBe("nomeregan is lost.");
  });

  it("keeps the spelling the sentence actually used", () => {
    expect(speakable(IPA, "GNOMEREGAN is lost.")).toContain(">GNOMEREGAN</phoneme>");
  });

  // One occurrence is enough to hear, and every extra tag is billed.
  it("touches only the first occurrence", () => {
    const spoken = speakable(IPA, "Gnomeregan, oh Gnomeregan.");
    expect(spoken.match(/<phoneme/g)).toHaveLength(1);
  });

  // The attribute is quoted, so an unescaped quote in the IPA would break the tag and leave
  // the model reading the markup aloud.
  it("cannot break out of the ph attribute", () => {
    expect(speakable({ ...IPA, ipa: 'no"ʊm' }, "Gnomeregan.")).toContain('ph="noʊm"');
  });
});

describe("previewKey", () => {
  it("is stable for the same request", () => {
    const input = { text: "hello", voiceId: "v1", config: CONFIG };
    expect(previewKey(input)).toBe(previewKey(input));
  });

  // Everything that changes the bytes, and nothing that does not.
  it("changes with the text, the voice, the model and the settings", () => {
    const base = { text: "hello", voiceId: "v1", config: CONFIG };
    const keys = new Set([
      previewKey(base),
      previewKey({ ...base, text: "goodbye" }),
      previewKey({ ...base, voiceId: "v2" }),
      previewKey({ ...base, config: { ...CONFIG, modelId: "eleven_flash_v2" } }),
      previewKey({
        ...base,
        config: { ...CONFIG, voiceSettings: { ...CONFIG.voiceSettings, stability: 0.9 } },
      }),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe("voicePicker", () => {
  const voices = new Map([
    ["human-male-standard", "v-human"],
    ["dwarf-male-standard", "v-dwarf"],
  ]);

  it("uses the NPC's own voice where the account has it", () => {
    expect(voicePicker(voices)(line("x", { voice: "dwarf-male-standard" }))).toBe("v-dwarf");
  });

  // A preview is about phonemes. Hearing them in the wrong voice beats a page that cannot
  // preview anything until all 20 voices exist.
  it("falls back to any voice rather than refusing", () => {
    expect(voicePicker(voices)(line("x", { voice: "orc-female-shaman" }))).toBe("v-human");
    expect(voicePicker(voices)(null)).toBe("v-human");
  });

  it("reports no voice when the account has none", () => {
    expect(voicePicker(new Map())(null)).toBeNull();
  });
});

describe("renderPreview", () => {
  const MP3 = Buffer.from("ID3fake-mp3-bytes");

  function elevenlabs() {
    const fetchImpl = vi.fn(
      async () =>
        Response.json(
          { audio_base64: MP3.toString("base64"), alignment: null },
          { headers: { "character-cost": "17" } },
        ),
    );
    return {
      calls: fetchImpl,
      options: {
        apiKey: "test-key",
        baseUrl: "https://stub.invalid",
        fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      },
    };
  }

  const pick = () => "v-human";

  it("renders an entry and returns what it cost", async () => {
    const { options } = elevenlabs();
    const result = await renderPreview(IPA, "sentence", pick, CONFIG, options, scratch());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.audio).toEqual(MP3);
    expect(result.preview.cached).toBe(false);
    expect(result.preview.credits).toBe(17);
    expect(result.preview.spoken).toContain("<phoneme");
  });

  /** The whole point of the cache: re-opening an entry must not spend credits again. */
  it("serves the second identical preview off disk without a request", async () => {
    const dir = scratch();
    const first = elevenlabs();
    await renderPreview(IPA, "sentence", pick, CONFIG, first.options, dir);
    expect(first.calls).toHaveBeenCalledTimes(1);

    const second = elevenlabs();
    const result = await renderPreview(IPA, "sentence", pick, CONFIG, second.options, dir);

    expect(second.calls).not.toHaveBeenCalled();
    expect(result.ok && result.preview.cached).toBe(true);
    expect(result.ok && result.preview.audio).toEqual(MP3);
    // Unknown rather than zero: the take cost what it cost when it was first made, and
    // reporting 0 would understate what the page has spent.
    expect(result.ok && result.preview.credits).toBeNull();
  });

  it("renders again when the pronunciation changes", async () => {
    const dir = scratch();
    await renderPreview(IPA, "sentence", pick, CONFIG, elevenlabs().options, dir);

    const edited = elevenlabs();
    await renderPreview({ ...IPA, ipa: "ɡnoʊmˈɹɛɡən" }, "sentence", pick, CONFIG, edited.options, dir);

    expect(edited.calls).toHaveBeenCalledTimes(1);
  });

  it("refuses when the account has no voice at all", async () => {
    const { calls, options } = elevenlabs();
    const result = await renderPreview(IPA, "sentence", () => null, CONFIG, options, scratch());

    expect(result.ok).toBe(false);
    expect(calls).not.toHaveBeenCalled();
  });

  /**
   * A failure must not leave a file behind. The next preview would serve it from cache as
   * though it were real audio, and it would play as silence.
   */
  it("caches nothing when the request fails", async () => {
    const dir = scratch();
    const fetchImpl = vi.fn(async () => new Response('{"detail":"nope"}', { status: 429 }));
    const result = await renderPreview(IPA, "sentence", pick, CONFIG, {
      apiKey: "k",
      baseUrl: "https://stub.invalid",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    }, dir);

    expect(result.ok).toBe(false);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  describe("word mode", () => {
    it("speaks the name alone, with the pronunciation still substituted", async () => {
      const { calls, options } = elevenlabs();
      const result = await renderPreview(IPA, "word", pick, CONFIG, options, scratch());

      expect(result.ok && result.preview.sentence).toBe("Gnomeregan");
      expect(result.ok && result.preview.spoken).toBe(
        '<phoneme alphabet="ipa" ph="ˈnoʊmɹəɡæn">Gnomeregan</phoneme>',
      );
      expect(result.ok && result.preview.source).toBeNull();
      expect(calls).toHaveBeenCalledTimes(1);
    });

    it("substitutes a respelling outright", async () => {
      const { options } = elevenlabs();
      const result = await renderPreview(ALIAS, "word", pick, CONFIG, options, scratch());
      expect(result.ok && result.preview.spoken).toBe("nomeregan");
    });

    /**
     * The two modes are different text, so previewKey separates them without needing to know
     * a mode exists - but only if it really is different text. Hearing the word must not
     * serve back the sentence someone rendered a moment earlier.
     */
    it("caches separately from sentence mode", async () => {
      const dir = scratch();
      const first = elevenlabs();
      await renderPreview(IPA, "sentence", pick, CONFIG, first.options, dir);

      const second = elevenlabs();
      await renderPreview(IPA, "word", pick, CONFIG, second.options, dir);

      expect(second.calls).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(dir)).toHaveLength(2);
    });

    it("still caches within its own mode", async () => {
      const dir = scratch();
      await renderPreview(IPA, "word", pick, CONFIG, elevenlabs().options, dir);

      const again = elevenlabs();
      const result = await renderPreview(IPA, "word", pick, CONFIG, again.options, dir);

      expect(again.calls).not.toHaveBeenCalled();
      expect(result.ok && result.preview.cached).toBe(true);
      expect(result.ok && result.preview.mode).toBe("word");
    });
  });

  describe("re-rolling", () => {
    it("ignores the cached take and pays again when forced", async () => {
      const dir = scratch();
      await renderPreview(IPA, "word", pick, CONFIG, elevenlabs().options, dir);

      const forced = elevenlabs();
      const result = await renderPreview(IPA, "word", pick, CONFIG, forced.options, dir, true);

      expect(forced.calls).toHaveBeenCalledTimes(1);
      expect(result.ok && result.preview.cached).toBe(false);
    });

    // The re-roll replaces the take rather than adding one, or the cache would grow a file
    // per attempt and the next unforced play would still get the first.
    it("overwrites the cached take rather than adding another", async () => {
      const dir = scratch();
      await renderPreview(IPA, "word", pick, CONFIG, elevenlabs().options, dir);
      await renderPreview(IPA, "word", pick, CONFIG, elevenlabs().options, dir, true);

      expect(fs.readdirSync(dir)).toHaveLength(1);
    });
  });

  describe("previewCache", () => {
    const config = CONFIG;
    const voices = new Map([["human-male-standard", "v-human"]]);

    it("reports nothing cached before anything is rendered", async () => {
      expect(await previewCache([IPA], voicePicker(voices), config, scratch())).toEqual({
        Gnomeregan: { word: false, sentence: false },
      });
    });

    /**
     * The state each button reads to decide whether pressing it costs money. It has to agree
     * with what renderPreview actually writes, per mode - a button claiming a take exists
     * when it does not is a button that quietly spends credits.
     */
    it("sees a rendered take, and only in the mode it was rendered in", async () => {
      const dir = scratch();
      await renderPreview(IPA, "word", () => "v-human", config, elevenlabs().options, dir);

      expect(await previewCache([IPA], voicePicker(voices), config, dir)).toEqual({
        Gnomeregan: { word: true, sentence: false },
      });
    });

    it("skips an entry with no pronunciation yet", async () => {
      const blank = { ...IPA, grapheme: "", ipa: undefined, alias: undefined };
      expect(await previewCache([blank], voicePicker(voices), config, scratch())).toEqual({});
    });

    it("reports nothing cached when the account has no voice", async () => {
      expect(await previewCache([IPA], voicePicker(new Map()), config, scratch())).toEqual({
        Gnomeregan: { word: false, sentence: false },
      });
    });
  });

  /**
   * The failure mode this guard exists for: on a model that ignores the tag, the preview
   * would come back sounding like the DEFAULT pronunciation, and someone checking their IPA
   * would conclude they had written it wrong and "fix" a transcription that was right.
   */
  it("refuses an IPA preview on a model that ignores phoneme tags", async () => {
    const { calls, options } = elevenlabs();
    const config = { ...CONFIG, modelId: "eleven_multilingual_v2" };
    const result = await renderPreview(IPA, "sentence", pick, config, options, scratch());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.message).toMatch(/ignores phoneme rules/);
    expect(calls).not.toHaveBeenCalled();
  });

  // A respelling is plain text. Every model reads it, so there is nothing to refuse.
  it("still previews a respelling on such a model", async () => {
    const { calls, options } = elevenlabs();
    const config = { ...CONFIG, modelId: "eleven_multilingual_v2" };
    const result = await renderPreview(ALIAS, "sentence", pick, config, options, scratch());

    expect(result.ok).toBe(true);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  // A preview asks about phonemes. Pinning it to a seed would tie the answer to whichever
  // NPC happened to say the sample sentence.
  it("sends no seed", async () => {
    const { calls, options } = elevenlabs();
    await renderPreview(IPA, "sentence", pick, CONFIG, options, scratch());

    const [, init] = calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("seed");
  });
});
