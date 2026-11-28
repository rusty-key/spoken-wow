/**
 * Claude, the second opinion in What's different. It cannot hear, so it reads a picture of the
 * three clips (spectrograms, pitch, long-term spectra) and their measurements.
 *
 * Reached with the caller's own Anthropic key. `fetchImpl` is injectable so no test spends anything.
 */
import Anthropic from "@anthropic-ai/sdk";

import { EFFECT_WORDS, PROMPT_ENDING, SIBILANT_WORDS } from "./limits";
import type { Difference } from "./gemini";

export const CLAUDE_MODEL = "claude-opus-5-5";

export type ClaudeOptions = { fetchImpl?: typeof globalThis.fetch; baseURL?: string; maxRetries?: number };

/** Reading a picture at high effort takes a minute or two; nginx gives /api/voices/ five. */
const CLAUDE_TIMEOUT_MS = 240_000;

function client(apiKey: string, options: ClaudeOptions, timeout = CLAUDE_TIMEOUT_MS): Anthropic {
  return new Anthropic({ apiKey, fetch: options.fetchImpl, baseURL: options.baseURL, maxRetries: options.maxRetries ?? 1, timeout });
}

/** Listing the models is free, so a key is checked before it is stored. */
export async function verifyAnthropicKey(key: string, options: ClaudeOptions = {}): Promise<{ tier: null }> {
  try {
    await client(key, { ...options, maxRetries: 0 }, 10_000).models.list({ limit: 1 });
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new Error(`checking the Anthropic key failed (${error.status ?? "no answer"}): ${error.message.slice(0, 300)}`);
    throw error;
  }
  return { tier: null };
}

export type ClaudeDifference = Difference & { fixes: string[] };

export type ClaudeDifferenceInput = {
  slot: string;
  version: number;
  /** The line as sent to the designed voice. */
  text: string;
  archetype: string;
  prompt: string;
  /** The reviewers' own notes on the version, oldest first. */
  notes: string[];
  /** evidenceTable's output; "" when nothing was measured. */
  numbers: string;
  /** The PNG; null when the site could not draw it. */
  image: Buffer | null;
};

const quoted = (words: readonly string[]) => words.map((word) => `"${word}"`).join(", ");

export const CLAUDE_SYSTEM = `You are the acoustic analyst on a voice design team. The team designs ElevenLabs voices for World of Warcraft NPC types and compares them with what players hear now.
You cannot hear audio. You read a picture and measurements of three recordings:
1. the game reference: the original game voice for this kind of character (inspiration only; game audio is pitch-shifted and processed; the picture shows its first 7 seconds),
2. the live take: one line as players hear it now,
3. the same line in the designed version under review.
The picture has one row per recording, in that order: a mel spectrogram 0-8 kHz with the pitch track in cyan. The last row overlays their long-term average spectra, in dB normalised to each one's peak, on a log frequency axis from 60 Hz to 10 kHz.

How to read the evidence:
- Lower F1/F2/F3 mean a bigger body and rounder vowels ("round", "boomy", "mooey" for tauren); higher means smaller and thinner.
- Weak energy under 150 Hz in the long-term spectrum means no chest.
- A bump at 2.5-3 kHz means a nasal twang ("cartoony").
- A steep loss above 4-5 kHz means muffled, "bad quality".
- High H1-H2 means breathy, airy; low means clean, pressed.
- Low HNR and harmonics that dissolve in the spectrogram mean rasp, growl, undead.
- F0 and voiced segments per second are pitch and pace; the duration ratio is pace on the same text.
- Compare the columns with each other rather than reading absolute values. Say by how much: Hz, dB, a ratio.
- Pitch tracking fails on growled voices. Where the cyan line breaks up or jumps, trust the spectrogram.

Findings from earlier reviews, as examples of the precision wanted:
- scourge-male-standard v2 against the reference: F0 136 vs 89 Hz, 1-4 kHz 10-15 dB louder, H1-H2 5.8 vs 13.2 dB (clean and pressed vs breathy and raspy): "an articulate elf, not undead".
- tauren-female-shaman v2: F0 167 vs 129 Hz, F1 636 vs 481 Hz, 10-15 dB less under 150 Hz, 15 dB less above 4 kHz: "small, thin, muffled, not round".
- orc-male-shady v3: 15 dB more at 2.5-3 kHz than both the reference and the live take: "a cartoony twang".

Return:
- summary: one or two sentences, the differences that matter most, with numbers.
- note: the difference that matters most, as an observation of how the designed version sounds next to the live take, not as a wish. Under 80 characters, lowercase, no full stop ("higher and thinner than the live take, no chest").
- wish: the same point said as what the next version should do, the opposite direction ("lower, rounder, more chest"). Under 80 characters, lowercase, no full stop.
- aspects: one per aspect that differs (pitch, pace, body and resonance, chest, nasality, breathiness, roughness, brightness, recording quality...): how the live take is, how the designed version is, and how the reference is where it tells something ("" otherwise). Concrete, with numbers.
- fixes: one to four concrete changes to the version's Voice Design prompt: which words to remove and which to add. They must keep these rules:
  - Never describe consonants or sibilants (no ${quoted(SIBILANT_WORDS)}): it makes every s harsh.
  - Never describe post-processing (${EFFECT_WORDS.join(", ")}, filters). Describe a clean voice.
  - Keep the prompt's ending: "${PROMPT_ENDING}"
The reviewers' notes say what they want. Point out the evidence that bears on them.`;

export function buildClaudeDifferenceText(input: Omit<ClaudeDifferenceInput, "image"> & { hasImage: boolean }): string {
  const v = `v${input.version}`;
  return `Slot: ${input.slot} (who uses it: ${input.archetype || "(unknown)"}). Version under review: ${v}.
The line, as sent to ${v} (square-bracketed words are performance directions, not speech): "${input.text}"
${v}'s Voice Design prompt: "${input.prompt}"
Reviewers' notes on ${v}, oldest first: ${input.notes.length > 0 ? JSON.stringify(input.notes) : "(none yet)"}
${input.hasImage ? "The picture is above." : "No picture this time: the measurements alone."}
${input.numbers ? `Measurements (openSMILE eGeMAPS means over each recording, and the site's s-level, room and level):\n${input.numbers}` : "No measurements this time: the picture alone."}
How does ${v} differ from the live take, and where does the reference stand?`;
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    note: { type: "string" },
    wish: { type: "string" },
    aspects: {
      type: "array",
      items: {
        type: "object",
        properties: { aspect: { type: "string" }, live: { type: "string" }, new: { type: "string" }, reference: { type: "string" } },
        required: ["aspect", "live", "new", "reference"],
        additionalProperties: false,
      },
    },
    fixes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "note", "wish", "aspects", "fixes"],
  additionalProperties: false,
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** A fenced answer is read too; malformed aspects and fixes are dropped. */
export function parseClaudeDifference(raw: string): ClaudeDifference {
  let answer: Record<string, unknown> | null;
  try {
    answer = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as Record<string, unknown> | null;
  } catch {
    throw new Error(`Claude did not answer in JSON: ${raw.slice(0, 200)}`);
  }
  if (!text(answer?.summary)) throw new Error("Claude returned no summary of the difference");
  const aspects = (Array.isArray(answer!.aspects) ? (answer!.aspects as Record<string, unknown>[]) : [])
    .filter((a) => text(a?.aspect) && typeof a.live === "string" && typeof a.new === "string")
    .map((a) => ({ aspect: text(a.aspect), live: text(a.live), new: text(a.new), ...(text(a.reference) ? { reference: text(a.reference) } : {}) }));
  return {
    summary: text(answer!.summary),
    note: text(answer!.note),
    wish: text(answer!.wish),
    aspects,
    fixes: Array.isArray(answer!.fixes) ? (answer!.fixes as unknown[]).map(text).filter(Boolean) : [],
  };
}

export async function describeDifferenceClaude(input: ClaudeDifferenceInput & { apiKey: string } & ClaudeOptions): Promise<ClaudeDifference> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: input.image.toString("base64") } });
  content.push({ type: "text", text: buildClaudeDifferenceText({ ...input, hasImage: input.image !== null }) });

  const response = await client(input.apiKey, input).beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    // A refusal falls back to the model Anthropic picks for its category instead of failing the press.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: CLAUDE_SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to compare these takes");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
  return parseClaudeDifference(response.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
}
