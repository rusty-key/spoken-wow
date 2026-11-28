import { describe, expect, it, vi } from "vitest";

import { buildClaudeDifferenceText, CLAUDE_MODEL, CLAUDE_SYSTEM, describeDifferenceClaude, parseClaudeDifference, verifyAnthropicKey } from "./claude";
import { PROMPT_ENDING } from "./limits";

/** An Anthropic Messages answer whose text is `text`. */
const message = (text: string, stop = "end_turn") =>
  Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: CLAUDE_MODEL,
    content: [{ type: "text", text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });

// What the manual trial found for scourge-male-standard v2, as Claude would return it.
const SCOURGE = {
  summary: "v2 is an articulate elf, not undead: F0 136 vs 89 Hz in the reference, 1-4 kHz 10-15 dB louder, H1-H2 5.8 vs 13.2 dB.",
  note: "cleaner and higher than the live take, no rasp",
  wish: "lower, raspier, breathier, undead",
  aspects: [
    { aspect: "Pitch", live: "110 Hz", new: "136 Hz", reference: "89 Hz" },
    { aspect: "Breathiness", live: "H1-H2 11 dB", new: "H1-H2 5.8 dB, clean and pressed", reference: "" },
  ],
  fixes: ["Remove 'articulate' and 'clear'.", "Add 'hollow, rasping, breathy undead voice, low in pitch'."],
};

describe("parseClaudeDifference", () => {
  it("reads Claude's answer into Gemini's shape plus its fixes, dropping an empty reference", () => {
    expect(parseClaudeDifference(JSON.stringify(SCOURGE))).toEqual({
      ...SCOURGE,
      aspects: [SCOURGE.aspects[0], { aspect: "Breathiness", live: "H1-H2 11 dB", new: "H1-H2 5.8 dB, clean and pressed" }],
    });
  });

  it("reads a fenced answer, and leaves out malformed aspects and fixes", () => {
    const fenced = "```json\n" + JSON.stringify({ ...SCOURGE, aspects: [{ aspect: "Pitch" }, SCOURGE.aspects[0]], fixes: ["", 3, "Add 'hollow'."] }) + "\n```";
    const said = parseClaudeDifference(fenced);
    expect(said.aspects).toEqual([SCOURGE.aspects[0]]);
    expect(said.fixes).toEqual(["Add 'hollow'."]);
  });

  it("refuses an answer that is not JSON or has no summary", () => {
    expect(() => parseClaudeDifference("The voices differ.")).toThrow(/JSON/);
    expect(() => parseClaudeDifference(JSON.stringify({ note: "x" }))).toThrow(/summary/);
  });
});

describe("the prompt", () => {
  it("tells Claude how to read the evidence, with the trial's findings as examples", () => {
    for (const part of ["F1/F2/F3", "under 150 Hz", "2.5-3 kHz", "above 4-5 kHz", "H1-H2", "HNR", "136 vs 89 Hz", "F1 636 vs 481 Hz", "cartoony twang", PROMPT_ENDING]) {
      expect(CLAUDE_SYSTEM).toContain(part);
    }
    // note observes, wish asks: the two must not be confused downstream.
    expect(CLAUDE_SYSTEM).toMatch(/note: .*not as a wish/);
  });

  it("gives the slot, who uses it, the prompt, the reviewers' notes and the numbers", () => {
    const text = buildClaudeDifferenceText({
      slot: "tauren-female-shaman",
      version: 2,
      text: "Walk with the Earth Mother.",
      archetype: "Tauren shamans",
      prompt: "A tauren shaman.",
      notes: ["not round enough"],
      numbers: "| F1 (Hz) | 481 | 520 | 636 |",
      hasImage: false,
    });
    for (const part of ["tauren-female-shaman", "Tauren shamans", "v2", "Walk with the Earth Mother.", "A tauren shaman.", "not round enough", "| F1 (Hz) | 481 | 520 | 636 |", "No picture"]) {
      expect(text).toContain(part);
    }
  });
});

describe("describeDifferenceClaude", () => {
  const input = {
    apiKey: "sk-ant-test",
    slot: "scourge-male-standard",
    version: 2,
    text: "The Lich King commands.",
    archetype: "Forsaken",
    prompt: "An undead man.",
    notes: [],
    numbers: "| F0 | 89 | 110 | 136 |",
    image: Buffer.from("png"),
    maxRetries: 0,
  };

  it("sends the picture and the numbers to the model, with fallbacks on, and reads the answer", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => message(JSON.stringify(SCOURGE)));
    const said = await describeDifferenceClaude({ ...input, fetchImpl: fetchImpl as never });
    expect(said.note).toBe("cleaner and higher than the live take, no rasp");
    expect(said.fixes).toHaveLength(2);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/v1/messages");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-ant-test");
    expect(new Headers(init.headers).get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "high", format: { type: "json_schema" } } });
    const [image, text] = body.messages[0].content;
    expect(image).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } });
    expect(text.text).toContain("| F0 | 89 | 110 | 136 |");
  });

  it("says so when Claude declines or is cut off", async () => {
    const refused = vi.fn(async () => message("", "refusal"));
    await expect(describeDifferenceClaude({ ...input, fetchImpl: refused as never })).rejects.toThrow(/declined/);
    const cut = vi.fn(async () => message('{"summary": "', "max_tokens"));
    await expect(describeDifferenceClaude({ ...input, fetchImpl: cut as never })).rejects.toThrow(/cut off/);
  });
});

describe("verifyAnthropicKey", () => {
  it("lists the models, which is free, and turns a refusal into a message", async () => {
    const ok = vi.fn(async () => Response.json({ data: [], has_more: false, first_id: null, last_id: null }));
    expect(await verifyAnthropicKey("sk-ant-good", { fetchImpl: ok as never })).toEqual({ tier: null });
    expect(String((ok.mock.calls[0] as unknown as [string])[0])).toContain("/v1/models");

    const bad = vi.fn(async () => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
    await expect(verifyAnthropicKey("sk-ant-bad", { fetchImpl: bad as never })).rejects.toThrow(/Anthropic key failed \(401\)/);
  });
});
