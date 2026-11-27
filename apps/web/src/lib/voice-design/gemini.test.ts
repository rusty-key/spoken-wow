import { describe, expect, it, vi } from "vitest";

import { blindLabels, buildPrompt, buildRevisePrompt, compareBlind, GEMINI_MODEL, reviseVoice, verifyGeminiKey } from "./gemini";
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
  const input = {
    slot: "troll-male-dark",
    version: 1,
    status: "needs-work",
    note: "No accent at all",
    siblings: { "troll-male-shaman": "Trolls need a Jamaican accent" },
    players: [
      { verdict: "off" as const, note: "sounds like a normal human" },
      { verdict: "fits" as const, note: "perfect gruffness" },
    ],
    archetype: "Shady witch doctor",
    prompt: "A troll. Perfect audio quality, dry close-mic studio recording, no reverb or effects.",
    previewText: "Hey mon.",
  };

  it("tells Gemini the note, the siblings' notes and the old prompt, with both recordings", async () => {
    const text = buildRevisePrompt(input);
    for (const part of ["No accent at all", "Doesn't fit: sounds like a normal human", "Fits: perfect gruffness", "Trolls need a Jamaican accent", "troll-male-shaman", "A troll.", "Hey mon.", PROMPT_ENDING]) {
      expect(text).toContain(part);
    }
    // Praise is kept, not fixed.
    expect(text).toMatch(/keep what they praise/i);
    expect(buildRevisePrompt({ ...input, players: [] })).not.toContain("Players' notes");
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ heard: "No accent.", prompt: "A troll, thick Jamaican accent.", preview_text: "Hey mon, welcome." }]) }] } }] }),
    );
    const revision = await reviseVoice({ ...input, apiKey: "k", reference: Buffer.from("ref"), sample: Buffer.from("smp"), fetchImpl: fetchImpl as never });
    // An array answer is read as its first element, and the prompt gets the agreed ending.
    expect(revision).toEqual({ heard: "No accent.", prompt: `A troll, thick Jamaican accent. ${PROMPT_ENDING}`, preview_text: "Hey mon, welcome.", changes: "" });
    const parts = JSON.parse(String(fetchImpl.mock.calls[0][1].body)).contents[0].parts;
    expect(parts.slice(1).map((p: { inline_data: { data: string } }) => Buffer.from(p.inline_data.data, "base64").toString())).toEqual(["ref", "smp"]);
  });
});
