import { describe, expect, it, vi } from "vitest";

import { blindLabels, buildDifferencePrompt, buildPrompt, buildRevisePrompt, compareBlind, describeDifference, GEMINI_MODEL, reviseVoice, verifyGeminiKey } from "./gemini";
import { PROMPT_ENDING } from "./limits";

describe("verifyGeminiKey", () => {
  it("lists the models, which costs nothing, with the key in its header", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ models: [] }));
    expect(await verifyGeminiKey("k-123", { fetchImpl })).toEqual({ tier: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({ headers: { "x-goog-api-key": "k-123" } }),
    );
  });

  it("refuses a key Gemini rejects, with what Gemini said", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    await expect(verifyGeminiKey("bad", { fetchImpl })).rejects.toThrow(/API key not valid/);
  });
});

const answer = (voices: Record<string, object>) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ voices, rankings: {} }) }] } }] });
const voice = { voice_design_prompt: "A gruff orc.", preview_text: "x".repeat(120) };

describe("blindLabels", () => {
  it("gives every slot a letter, in an order the random source decides", () => {
    const labels = blindLabels(["orc-male-guard", "orc-male-shady", "orc-male-standard"], () => 0);
    expect(Object.keys(labels)).toEqual(["A", "B", "C"]);
    expect(new Set(Object.values(labels))).toEqual(new Set(["orc-male-guard", "orc-male-shady", "orc-male-standard"]));
  });
});

describe("buildPrompt", () => {
  const prompt = buildPrompt({
    group: "orc-male",
    flavors: [
      { label: "A", npcs: ["Ulathek", "Snarl"], measures: null },
      { label: "B", npcs: ["Razor Hill Grunt"], measures: { f0Hz: 98 } as never },
    ],
  });

  it("names every recording and who uses it", () => {
    for (const text of ["Recording A", "Recording B", "Ulathek", "Snarl", "Razor Hill Grunt", "male orc", "98"]) {
      expect(prompt).toContain(text);
    }
  });

  it("never names the flavors, which would tell the listener what to hear", () => {
    expect(prompt).not.toMatch(/shady|guard|standard/);
  });
});

describe("compareBlind", () => {
  it("sends the prompt, then each recording under its letter, asking for JSON", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => answer({ A: voice, B: voice }));
    const result = await compareBlind({
      apiKey: "k",
      prompt: "listen",
      clips: [
        { label: "A", audio: Buffer.from("a") },
        { label: "B", audio: Buffer.from("b") },
      ],
      fetchImpl: fetchImpl as never,
    });
    expect(result.voices.A.voice_design_prompt).toBe(`A gruff orc. ${PROMPT_ENDING}`);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(GEMINI_MODEL).toBe("gemini-3.1-pro-preview");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "k" });
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", temperature: 0.2 });
    expect(body.contents[0].parts).toEqual([
      { text: "listen" },
      { text: "Recording A:" },
      { inline_data: { mime_type: "audio/mpeg", data: Buffer.from("a").toString("base64") } },
      { text: "Recording B:" },
      { inline_data: { mime_type: "audio/mpeg", data: Buffer.from("b").toString("base64") } },
    ]);
  });

  it("refuses an answer about other recordings than it was sent", async () => {
    const fetchImpl = vi.fn(async () => answer({ A: voice, C: voice }));
    await expect(
      compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }, { label: "B", audio: Buffer.from("b") }], fetchImpl }),
    ).rejects.toThrow(/B/);
  });

  it("refuses an answer that is not JSON", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "Sure! Here" }] } }] }));
    await expect(compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }], fetchImpl })).rejects.toThrow(/JSON/);
  });

  it("says what Gemini said when it refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    await expect(compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }], fetchImpl })).rejects.toThrow(/400.*bad request/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("waits and tries again when Gemini is rate limited, one request at a time", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(answer({ A: voice }));
    await compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }], fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after three rate-limited tries", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    await expect(
      compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }], fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow(/429.*quota/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("asks for no consonant or effect wording, and the agreed ending", () => {
    const prompt = buildPrompt({ group: "troll-male", flavors: [{ label: "A", npcs: [], measures: null }] });
    expect(prompt).toContain("Never describe consonants or sibilants");
    expect(prompt).toContain(PROMPT_ENDING);
    expect(prompt).not.toContain("Perfect audio quality");
  });
});

describe("reviseVoice", () => {
  const history = [
    { version: 1, prompt: "A troll. ".repeat(40), reviews: [{ status: "needs-work", note: "Sounds female", observations: [], players: [] }], satisfiedBy: 2 },
    {
      version: 2,
      prompt: "A troll, unmistakably masculine.",
      reviews: [
        {
          status: "needs-work",
          note: "No accent at all",
          observations: [],
          players: [
            { verdict: "off" as const, note: "sounds like a normal human" },
            { verdict: "fits" as const, note: "perfect gruffness" },
          ],
        },
      ],
      satisfiedBy: null,
    },
  ];
  const input = {
    slot: "troll-male-dark",
    version: 2,
    status: "needs-work",
    history,
    siblings: [{ slot: "troll-male-shaman", version: 3, note: "Trolls need a Jamaican accent" }],
    archetype: "Shady witch doctor",
    prompt: "A troll. Perfect audio quality, dry close-mic studio recording, no reverb or effects.",
    previewText: "Hey mon.",
    line: "Ya got business wit me?",
    numbers: "",
  };

  it("tells Gemini every version's notes, the siblings' notes and the old prompt", () => {
    const text = buildRevisePrompt({ ...input, hasLive: true });
    for (const part of ["No accent at all", "Doesn't fit: sounds like a normal human", "Fits: perfect gruffness", "Trolls need a Jamaican accent", "troll-male-shaman v3", "A troll.", "Hey mon.", "Ya got business wit me?", PROMPT_ENDING]) {
      expect(text).toContain(part);
    }
    // An old version's prompt is cut short; the one revised is given whole.
    expect(text).toContain(`v1 prompt: "${"A troll. ".repeat(40).slice(0, 200)}…"`);
    expect(text).toContain("Second: the live take of the line below, what players hear now: the target");
    expect(buildRevisePrompt({ ...input, hasLive: false })).toContain("This line has no live take");
  });

  it("hears the reference, the live take and the version's take, in that order", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ heard: "No accent.", prompt: "A troll, thick Jamaican accent.", preview_text: "Hey mon, welcome." }]) }] } }] }),
    );
    const heard = (call: number) =>
      JSON.parse(String(fetchImpl.mock.calls[call][1].body))
        .contents[0].parts.slice(1)
        .map((p: { inline_data: { data: string } }) => Buffer.from(p.inline_data.data, "base64").toString());
    const revision = await reviseVoice({ ...input, apiKey: "k", reference: Buffer.from("ref"), live: Buffer.from("live"), sample: Buffer.from("smp"), fetchImpl: fetchImpl as never });
    // An array answer is read as its first element, and the prompt gets the agreed ending.
    expect(revision).toEqual({ heard: "No accent.", prompt: `A troll, thick Jamaican accent. ${PROMPT_ENDING}`, preview_text: "Hey mon, welcome.", changes: "" });
    expect(heard(0)).toEqual(["ref", "live", "smp"]);

    await reviseVoice({ ...input, apiKey: "k", reference: Buffer.from("ref"), live: null, sample: Buffer.from("smp"), fetchImpl: fetchImpl as never });
    expect(heard(1)).toEqual(["ref", "smp"]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1].body)).contents[0].parts[0].text).toContain("This line has no live take");
  });
});

describe("describeDifference", () => {
  const reply = (answer: unknown) => vi.fn(async (_url: string, _init: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
  const heard = (fetchImpl: ReturnType<typeof reply>) =>
    JSON.parse(String(fetchImpl.mock.calls[0][1].body))
      .contents[0].parts.slice(1)
      .map((p: { inline_data: { data: string } }) => Buffer.from(p.inline_data.data, "base64").toString());
  const input = { apiKey: "k", slot: "bloodelf-female", version: 3, text: "t", live: Buffer.from("live"), sample: Buffer.from("new") };

  it("reads the observation and its opposite as the wish, kept apart, and each aspect's weight", async () => {
    const fetchImpl = reply({
      summary: "Slower.",
      note: "slower and breathier",
      wish: "faster, less breathy",
      aspects: [
        { aspect: "Cadence", reference: "clipped, short pauses", live: "brisk", new: "long pauses after every phrase", matters: "high" },
        { aspect: "Recording", reference: "", live: "clean", new: "clean", matters: "whatever" },
        { aspect: "Broken" },
      ],
    });
    const said = await describeDifference({ ...input, reference: Buffer.from("ref"), fetchImpl: fetchImpl as never });
    expect(said).toEqual({
      summary: "Slower.",
      note: "slower and breathier",
      wish: "faster, less breathy",
      aspects: [
        { aspect: "Cadence", reference: "clipped, short pauses", live: "brisk", new: "long pauses after every phrase", matters: "high" },
        { aspect: "Recording", live: "clean", new: "clean" },
      ],
    });
    expect(heard(fetchImpl)).toEqual(["ref", "live", "new"]);
  });

  it("compares the two takes alone when the slot has no reference clip", async () => {
    const fetchImpl = reply({ summary: "s", note: "n", wish: "w", aspects: [] });
    await describeDifference({ ...input, reference: null, fetchImpl: fetchImpl as never });
    expect(heard(fetchImpl)).toEqual(["live", "new"]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body)).contents[0].parts[0].text).not.toContain("original game voice");
  });

  it("asks for the observation apart from the wish, and goes through what a director listens for", () => {
    const text = buildDifferencePrompt({ slot: "bloodelf-female", version: 3, text: "t", hasReference: true });
    expect(text).toMatch(/as an observation of how v3 sounds next to the live take \(not a wish\)/);
    // The live take is the goal: the reference never makes it "lack" anything.
    expect(text).toContain("The live take is the target");
    expect(text).toContain("Never criticise the live take or say it lacks anything");
    expect(text).toContain("never ask the designed version for something the live take does not have");
    for (const part of ["accent: which one, how strong", "cadence and phrasing", "intonation", "emphasis", "emotional tone", "persona", "delivery style", "high, medium or low", "First recording: the original game voice"]) {
      expect(text).toContain(part);
    }
  });
});
