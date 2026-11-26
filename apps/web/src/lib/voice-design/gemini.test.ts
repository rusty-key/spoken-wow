import { describe, expect, it, vi } from "vitest";

import { blindLabels, buildPrompt, compareBlind, GEMINI_MODEL, verifyGeminiKey } from "./gemini";

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
    expect(result.voices.A.voice_design_prompt).toBe("A gruff orc.");
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
    const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    await expect(compareBlind({ apiKey: "k", prompt: "p", clips: [{ label: "A", audio: Buffer.from("a") }], fetchImpl })).rejects.toThrow(/429.*quota/);
  });
});
