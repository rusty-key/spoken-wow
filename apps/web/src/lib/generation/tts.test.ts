import { describe, expect, it, vi } from "vitest";

import * as leadin from "./leadin";
import {
  buildDialoguePayload,
  buildPayload,
  dialogueCharacters,
  textToDialogue,
  textToSpeech,
} from "./tts";
import { LEAD_IN } from "./leadin";

vi.mock("./leadin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./leadin")>();
  return { ...actual, trimLeadIn: vi.fn(actual.trimLeadIn) };
});

const SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
} as const;

const REQUEST = {
  voiceId: "voice-abc",
  text: "Hmm. The mines are not safe.",
  modelId: "eleven_multilingual_v2",
  voiceSettings: { ...SETTINGS },
  seed: 1163733943,
};

/** An alignment of `text`, each character 0.1s after the one before. */
function alignmentOf(text: string) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index / 10),
    character_end_times_seconds: characters.map((_, index) => (index + 1) / 10),
  };
}

/** What the with-timestamps endpoints answer: the audio in base64, beside its alignment. */
function timedBody(audio: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ audio_base64: Buffer.from(audio).toString("base64"), ...extra });
}

function audioResponse(
  body = "ID3fake-mp3-bytes",
  cost = "17",
  extra: Record<string, unknown> = { alignment: alignmentOf("Hmm. The") },
): Response {
  return new Response(timedBody(body, extra), {
    status: 200,
    headers: { "content-type": "application/json", "character-cost": cost },
  });
}

function stub(response: Response | Promise<Response>) {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

const OPTIONS = { apiKey: "test-key", baseUrl: "https://stub.invalid" };

/**
 * The payload has to match build_payload in the retired tts_cli/synthesize.py, which cut
 * much of the archive. The addon resolves a sound by filename and cannot tell which
 * produced it, so a take cut here and one it cut must be the same kind of thing.
 */
describe("buildPayload", () => {
  it("sends what the Python generator sends", () => {
    expect(buildPayload(REQUEST)).toEqual({
      text: "Hmm. The mines are not safe.",
      model_id: "eleven_multilingual_v2",
      voice_settings: SETTINGS,
      seed: 1163733943,
    });
  });

  /**
   * A multilingual model infers the language from the text, and a short input gives it
   * almost nothing to go on - a bare name in a word preview gives it nothing at all, which is
   * how one comes back with another language's vowels. language_code governs text
   * normalization too, so it plausibly decides how a phoneme string is read.
   */
  it("pins the language on a model that accepts one", () => {
    expect(buildPayload({ ...REQUEST, modelId: "eleven_v3" }).language_code).toBe("en");
    expect(buildPayload({ ...REQUEST, modelId: "eleven_flash_v2_5" }).language_code).toBe("en");
  });

  it("says the take's language, and English when none is named", () => {
    expect(buildPayload({ ...REQUEST, modelId: "eleven_v3", languageCode: "pt" }).language_code).toBe(
      "pt",
    );
    expect(buildPayload({ ...REQUEST, modelId: "eleven_v3" }).language_code).toBe("en");
  });

  // Omitting is exactly today's behaviour, so a model absent from the list loses nothing -
  // whereas sending the field to one that rejects it would fail a request that used to work.
  it("omits it for a model that does not accept one", () => {
    expect(buildPayload(REQUEST)).not.toHaveProperty("language_code");
    expect(buildPayload({ ...REQUEST, modelId: "eleven_multilingual_v2" })).not.toHaveProperty(
      "language_code",
    );
  });

  /**
   * The one place this differs from the retired Python generator, which sent no dictionary
   * at all -- which is exactly why the locator is recorded per take.
   */
  it("sends no dictionary when there is none, matching the Python payload", () => {
    expect(buildPayload({ ...REQUEST, dictionary: null })).not.toHaveProperty(
      "pronunciation_dictionary_locators",
    );
    expect(buildPayload(REQUEST)).not.toHaveProperty("pronunciation_dictionary_locators");
  });

  // The version is not optional. Naming the dictionary alone would let a later upload change
  // how an already-recorded take would sound, which is what dictionaryVersion exists to pin.
  it("pins the dictionary to a version when one is in force", () => {
    const payload = buildPayload({
      ...REQUEST,
      dictionary: { dictionaryId: "dict-abc", versionId: "ver-1" },
    });
    expect(payload.pronunciation_dictionary_locators).toEqual([
      { pronunciation_dictionary_id: "dict-abc", version_id: "ver-1" },
    ]);
  });

  // Python omits the key entirely when the strategy is "none"; sending null would be a value
  // ElevenLabs has to interpret rather than a field it never sees.
  it("omits the seed rather than sending null", () => {
    expect(buildPayload({ ...REQUEST, seed: null })).not.toHaveProperty("seed");
  });

  it("does not set an output format, so both sides take the API's default", () => {
    expect(buildPayload(REQUEST)).not.toHaveProperty("output_format");
  });
});

describe("textToSpeech", () => {
  it("posts to the voice's endpoint with the key", async () => {
    const fetchImpl = stub(audioResponse());
    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });

    // Both false/null: REQUEST is eleven_multilingual_v2, which would read the brackets
    // aloud, so no lead-in is sent and there is nothing to trim back off.
    expect(result).toEqual({
      ok: true,
      audio: Buffer.from("ID3fake-mp3-bytes"),
      leadIn: false,
      leadInSec: null,
      credits: 17,
      words: [
        { word: "Hmm.", start: 0 },
        { word: "The", start: 0.5 },
      ],
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://stub.invalid/v1/text-to-speech/voice-abc/with-timestamps");
    expect(init.method).toBe("POST");
    expect(init.headers["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual(buildPayload(REQUEST));
  });

  it("reports running out of credits as a stopping condition", async () => {
    const fetchImpl = stub(
      new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "no credits" } }), {
        status: 401,
      }),
    );

    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota");
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("no credits");
  });

  /**
   * It earns its place: an error served with a 200 would otherwise be archived as an mp3
   * and play as silence in the game - a failure nothing would notice until someone talked
   * to that NPC.
   */
  it("refuses a 200 that is not audio", async () => {
    const fetchImpl = stub(
      new Response(JSON.stringify({ detail: "something went wrong" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.message).toContain("application/json");
    expect(result.failure.message).toContain("rather than audio");
  });

  it("refuses an empty 200 rather than storing a zero-byte mp3", async () => {
    const fetchImpl = stub(
      new Response(timedBody(""), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.message).toContain("empty");
  });

  it("keeps the audio, without times, when no alignment came with it", async () => {
    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl: stub(audioResponse("bytes", "17", {})) });
    expect(result.ok && result.words).toBeNull();
  });

  // The alignment is of the audio as it arrived; the addon plays it with the lead-in cut off.
  it("moves the times back by the lead-in that was cut", async () => {
    vi.mocked(leadin.trimLeadIn).mockResolvedValueOnce({
      audio: Buffer.from("trimmed"),
      leadIn: true,
      leadInSec: 2.5,
    });
    const text = "[clears throat] [long pause] Hi there.";
    const fetchImpl = stub(audioResponse("raw", "17", { alignment: alignmentOf(text) }));
    const result = await textToSpeech({ ...REQUEST, modelId: "eleven_v3" }, { ...OPTIONS, fetchImpl });

    expect(result.ok && result.words).toEqual([
      { word: "Hi", start: text.indexOf("Hi") / 10 - 2.5 },
      { word: "there.", start: text.indexOf("there") / 10 - 2.5 },
    ]);
  });

  // A dropped connection says nothing about the next line, so it must not stop a batch.
  it("survives a transport failure without stopping the batch", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof globalThis.fetch;

    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("upstream");
    expect(result.failure.fatal).toBe(false);
    expect(result.failure.message).toContain("ECONNRESET");
  });

  it("refuses to call out at all with no key", async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;
    const result = await textToSpeech(REQUEST, { apiKey: "", baseUrl: "x", fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * ElevenLabs does not bill the characters you send. It bills round(characters * rate), and
 * the rate belongs to the plan: measured at 0.55 on the account this was built against, so
 * a 310-character line cost 170. The header is the only way to know the real figure without
 * guessing at someone's plan, and it agreed with the usage-stats delta on every model and
 * length tried.
 */
describe("what a request actually cost", () => {
  it("reports the cost ElevenLabs charged, not the length of the text", async () => {
    const fetchImpl = stub(audioResponse("ID3bytes", "55"));
    const result = await textToSpeech({ ...REQUEST, text: "A".repeat(100) }, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credits).toBe(55);
  });

  // Reporting a number that was not charged is worse than reporting none: the whole reason
  // this is read rather than computed is that the rate cannot be derived from the request.
  it("reports nothing rather than guessing when the header is absent", async () => {
    const fetchImpl = stub(
      new Response(timedBody("ID3bytes"), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credits).toBeNull();
  });

  it("ignores a header that is not a usable number", async () => {
    for (const cost of ["", "unknown", "-5", "NaN"]) {
      const fetchImpl = stub(audioResponse("ID3bytes", cost));
      const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });
      expect(result.ok && result.credits).toBeFalsy();
    }
  });

  it("reads a zero cost as zero, not as absent", async () => {
    const fetchImpl = stub(audioResponse("ID3bytes", "0"));
    const result = await textToSpeech(REQUEST, { ...OPTIONS, fetchImpl });
    expect(result.ok && result.credits).toBe(0);
  });
});

const base = {
  inputs: [
    { text: "Excellent.", voiceId: "npc-voice" },
    { text: "He reads.", voiceId: "narrator-voice" },
  ],
  modelId: "eleven_v3",
  stability: 0.5,
  seed: null,
  dictionary: null,
};

describe("buildDialoguePayload", () => {
  it("keeps the turns in order, each with its own voice", () => {
    // The first turn carries the lead-in; the second must not, or a throat clear would land
    // mid-file where nothing trims it.
    expect(buildDialoguePayload(base).inputs).toEqual([
      { text: `${LEAD_IN}Excellent.`, voice_id: "npc-voice" },
      { text: "He reads.", voice_id: "narrator-voice" },
    ]);
  });

  it("sends only stability, which is all the endpoint documents", () => {
    // Recording settings the API ignored would make a take's provenance a lie.
    expect(buildDialoguePayload(base).settings).toEqual({ stability: 0.5 });
  });

  it("omits the seed when there is none, matching buildPayload", () => {
    expect("seed" in buildDialoguePayload(base)).toBe(false);
    expect(buildDialoguePayload({ ...base, seed: 7 }).seed).toBe(7);
  });

  it("carries a pronunciation dictionary with its version pinned", () => {
    const payload = buildDialoguePayload({
      ...base,
      dictionary: { dictionaryId: "d1", versionId: "v1" },
    });
    expect(payload.pronunciation_dictionary_locators).toEqual([
      { pronunciation_dictionary_id: "d1", version_id: "v1" },
    ]);
  });

  it("carries the language on a model that takes one", () => {
    expect(buildDialoguePayload(base).language_code).toBeDefined();
    expect(buildDialoguePayload({ ...base, modelId: "eleven_multilingual_v2" }).language_code)
      .toBeUndefined();
  });
});

describe("dialogueCharacters", () => {
  it("counts every turn, since the limit is across all of them", () => {
    // Including the lead-in, because the endpoint's limit counts what it is sent.
    expect(dialogueCharacters(base)).toBe(
      LEAD_IN.length + "Excellent.".length + "He reads.".length,
    );
  });
});

describe("textToDialogue", () => {
  // The endpoint joins the turns' characters with no space between them: "Excellent.He".
  it("starts a word at each turn, which the alignment does not separate", async () => {
    const fetchImpl = stub(
      audioResponse("ID3bytes", "9", {
        alignment: alignmentOf("Excellent.He reads."),
        voice_segments: [{ character_start_index: 0 }, { character_start_index: 10 }],
      }),
    );
    const result = await textToDialogue(
      { ...base, modelId: "eleven_multilingual_v2" },
      { ...OPTIONS, fetchImpl },
    );

    expect(result.ok && result.words?.map((word) => word.word)).toEqual(["Excellent.", "He", "reads."]);
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://stub.invalid/v1/text-to-dialogue/with-timestamps");
  });

  it("refuses to send more than the endpoint accepts, without calling it", async () => {
    let called = false;
    const result = await textToDialogue(
      { ...base, inputs: [{ text: "x".repeat(2_001), voiceId: "npc-voice" }] },
      {
        apiKey: "test-key",
        fetchImpl: (async () => {
          called = true;
          return new Response(null);
        }) as unknown as typeof globalThis.fetch,
      },
    );

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
