/**
 * Gemini, which listens to a race-gender's game clips side by side on /voices/design.
 *
 * Reached over REST with the caller's own key, like ElevenLabs. `fetchImpl` is injectable so no
 * test spends anything.
 */
import { setTimeout as wait } from "node:timers/promises";

import { shuffle } from "@/lib/shuffle";
import { failure } from "@/lib/voices/elevenlabs";

import { EFFECT_WORDS, PROMPT_ENDING, SIBILANT_WORDS, withEnding } from "./limits";
import type { GeminiResult, Observation, PlayerNote, Verdict } from "./types";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiOptions = { fetchImpl?: typeof globalThis.fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void> };

/** Listing the models is free, so a key is checked before it is stored. Gemini has no plans. */
export async function verifyGeminiKey(key: string, options: GeminiOptions = {}): Promise<{ tier: null }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${options.baseUrl ?? GEMINI_BASE_URL}/models`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await failure(response, "checking the Gemini key");
  return { tier: null };
}

export const GEMINI_MODEL = "gemini-3.1-pro-preview";

/** Consonant wording and the old studio sentence make every s harsh; effects come out badly. */
const quoted = (words: readonly string[]) => words.map((word) => `"${word}"`).join(", ");
const DRAFTING_RULES = `- Never describe consonants or sibilants (no ${quoted(SIBILANT_WORDS)}): it makes every s harsh.
- Never describe post-processing (${EFFECT_WORDS.join(", ")}, filters). Describe a clean voice.
- End the prompt exactly with: "${PROMPT_ENDING}"`;

/** Three clips of game barks are a few megabytes; Gemini listening to them takes a while. */
const COMPARE_TIMEOUT_MS = 300_000;

/** Letters for the recordings, shuffled, so the order never hints which flavor is which. */
export function blindLabels(slots: readonly string[], random: () => number = Math.random): Record<string, string> {
  return Object.fromEntries(shuffle(slots, random).map((slot, index) => [String.fromCharCode(65 + index), slot]));
}

export type PromptFlavor = { label: string; npcs: string[]; measures: Record<string, number> | null };

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The flavor names stay out: told "shady", a listener hears shady. Who uses each voice goes in,
 * since the voice must suit them.
 */
export function buildPrompt(input: { group: string; flavors: PromptFlavor[] }): string {
  const [race, gender] = input.group.split("-");
  const who = `${gender ?? ""} ${race}`.trim();
  const labels = input.flavors.map((flavor) => flavor.label);
  const users = input.flavors
    .map((flavor) => `- Recording ${flavor.label} is used by: ${flavor.npcs.length > 0 ? flavor.npcs.join(", ") : "(no named characters)"}`)
    .join("\n");
  const measured = input.flavors.filter((flavor) => flavor.measures);
  const measures = measured.length
    ? `\n\nopenSMILE eGeMAPS measurements per recording. Game audio is processed, so compare them with each other rather than reading them as absolute:\n${measured
        .map((flavor) => `- ${flavor.label}: ${Object.entries(flavor.measures!).map(([key, value]) => `${key} ${round(value)}`).join(", ")}`)
        .join("\n")}`
    : "";
  const shape = labels.map((label) => `"${label}": {...}`).join(", ");
  return `You are a casting director and voice coach. You will hear ${labels.length} voice recordings, ${labels.join(", ")}.
Each is one character type from a fantasy video game: a ${who}, several short in-game barks
stitched together. They are different variants of the same race and gender.

Describe each voice so a voice designer could recreate the *kind* of voice from text alone
(not clone it). Judge relative to the others: what makes each one distinct.

Separate the voice itself from post-processing (reverb, pitch shifting, filtering, distortion);
report processing in its own field.

The voice has to suit the characters who use it:
${users}${measures}

For each recording also write an ElevenLabs Voice Design prompt and a preview text:
- voice_design_prompt: 3-5 sentences: age, gender and race, and the role of the characters above;
  "unmistakably masculine" or "unmistakably feminine"; pitch, timbre and texture; pace, energy and
  attitude, and what the voice is NOT if a word could pull it the wrong way; the accent.
${DRAFTING_RULES}
- preview_text: 100 to 300 characters the character would really say, in their normal register,
  in the style of the game's quest and gossip text. Not a mentor speech unless the character is one.

Return JSON only:
{
 "voices": {
  ${shape.replace(/\{\.\.\.\}/, `{
   "apparent_age": "...",
   "pitch": "...", "timbre": "...", "texture": "(rasp, gravel, breathiness, growl, nasality...)",
   "resonance_and_size": "...",
   "pace_and_rhythm": "...", "energy": "...", "intonation": "...",
   "attitude_persona": "...", "accent_and_articulation": "...",
   "processing": "...",
   "archetype": "one short phrase",
   "voice_design_prompt": "...",
   "preview_text": "..."
  }`)}
 },
 "rankings": {
  "deepest_to_highest": ["..."], "roughest_to_smoothest": ["..."],
  "most_to_least_energetic": ["..."], "most_to_least_menacing": ["..."],
  "most_to_least_sly_or_sneaky": ["..."], "most_to_least_authoritative": ["..."]
 },
 "same_actor_guess": "which, if any, sound like the same voice actor, and why"
}`;
}

type Candidate = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

/** Gemini answers 429 well before a burst of a few requests; spaced retries get through. */
const RETRY_DELAYS_MS = [2_000, 6_000];
const RETRIED = new Set([429, 500, 502, 503, 504]);

/**
 * One Gemini call answered in JSON. Retried on rate limits and outages, one request at a time.
 * Gemini sometimes wraps the object in an array; the first element is the answer.
 */
export async function generateJson(
  input: { apiKey: string; parts: unknown[] } & GeminiOptions,
): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const sleep = input.sleep ?? ((ms: number) => wait(ms));
  let response: Response | null = null;
  for (const delay of [...RETRY_DELAYS_MS, null]) {
    response = await fetchImpl(`${input.baseUrl ?? GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        contents: [{ parts: input.parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
    });
    if (response.ok || delay === null || !RETRIED.has(response.status)) break;
    await response.body?.cancel();
    await sleep(delay);
  }
  if (!response!.ok) throw await failure(response!, "Gemini");

  const body = (await response!.json()) as Candidate;
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini did not answer in JSON: ${text.slice(0, 200)}`);
  }
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

const audioPart = (audio: Buffer) => ({ inline_data: { mime_type: "audio/mpeg", data: audio.toString("base64") } });

/** Gemini's blind comparison of the clips. Throws on any answer not about exactly these labels. */
export async function compareBlind(
  input: { apiKey: string; prompt: string; clips: { label: string; audio: Buffer }[] } & GeminiOptions,
): Promise<GeminiResult> {
  const parts: unknown[] = [{ text: input.prompt }];
  for (const clip of input.clips) parts.push({ text: `Recording ${clip.label}:` }, audioPart(clip.audio));
  const result = (await generateJson({ ...input, parts })) as GeminiResult;

  const sent = input.clips.map((clip) => clip.label).sort();
  const heard = Object.keys(result?.voices ?? {}).sort();
  if (sent.join() !== heard.join()) {
    throw new Error(`Gemini described recordings ${heard.join(", ") || "none"}, not ${sent.join(", ")}`);
  }
  for (const label of sent) {
    const voice = result.voices[label];
    if (typeof voice?.voice_design_prompt !== "string" || typeof voice.preview_text !== "string") {
      throw new Error(`Gemini wrote no prompt or preview text for recording ${label}`);
    }
    voice.voice_design_prompt = withEnding(voice.voice_design_prompt);
  }
  return result;
}

/** `changes` is the same fix said as a change to the existing voice, for Voice Remix. */
export type Revision = { heard: string; prompt: string; preview_text: string; changes: string };

/** One verdict as revise reads it: the reviewer's own words apart from what a judge observed. */
export type HistoryReview = { status: string; note: string; observations: Observation[]; players: PlayerNote[] };

export type HistoryVersion = {
  version: number;
  prompt: string;
  reviews: HistoryReview[];
  /** The first later version marked good: this version's notes were satisfied by then. */
  satisfiedBy: number | null;
};

/** The newest note on another flavor of the race. */
export type SiblingNote = { slot: string; version: number; note: string };

export type ReviseInput = {
  slot: string;
  version: number;
  /** "good", "needs-work", or "not reviewed yet". */
  status: string;
  /** Every version of the slot, oldest first, the one revised last. */
  history: HistoryVersion[];
  siblings: SiblingNote[];
  archetype: string;
  prompt: string;
  previewText: string;
  /** The sample line Gemini hears, as sent to the version. */
  line: string;
  /** Whether the live take of that line goes with it. */
  hasLive: boolean;
  /** evidenceTable's output; "" without the measuring helper. */
  numbers: string;
};

/** The player's answer as Gemini reads it: prompt text, so English whatever the page's language. */
const ANSWER: Record<Verdict, string> = { fits: "Fits", close: "Close", off: "Doesn't fit", skip: "Skipped" };

const JUDGE_NAME: Record<Observation["by"], string> = { gemini: "Gemini", claude: "Claude" };

/** How long an old version's prompt is shown: enough to see what it tried. */
const OLD_PROMPT_CHARS = 200;

function historyLines(entry: HistoryVersion, current: number): string[] {
  const v = `v${entry.version}`;
  const lines = [
    entry.version === current
      ? `${v} (the version being revised; its prompt is below)`
      : `${v} prompt: "${entry.prompt.length > OLD_PROMPT_CHARS ? `${entry.prompt.slice(0, OLD_PROMPT_CHARS)}…` : entry.prompt}"`,
  ];
  const state = entry.satisfiedBy === null ? "open" : `satisfied: v${entry.satisfiedBy} was marked good`;
  if (entry.reviews.length === 0) lines.push("  - not reviewed");
  for (const review of entry.reviews) {
    lines.push(`  - verdict ${review.status}. Reviewer's note: ${review.note ? `"${review.note}" [${state}]` : "(none)"}`);
    for (const pick of review.players) lines.push(`    Player's note the reviewer chose to act on [${state}]: "${ANSWER[pick.verdict]}: ${pick.note}"`);
    for (const seen of review.observations) {
      lines.push(`    Observation by ${JUDGE_NAME[seen.by]}, ${v}'s take compared with the live take (how ${v} sounds, NOT a wish): "${seen.note}"`);
      if (seen.fixes?.length) lines.push(`    ${JUDGE_NAME[seen.by]}'s suggested prompt changes for ${v}: ${JSON.stringify(seen.fixes)}`);
    }
  }
  return lines;
}

/** What Gemini is asked when revising a version from its review. */
export function buildRevisePrompt(input: ReviseInput): string {
  const v = `v${input.version}`;
  const siblings = input.siblings.length
    ? input.siblings.map((sibling) => `- ${sibling.slot} v${sibling.version}: "${sibling.note}"`).join("\n")
    : "(none)";
  const recordings = input.hasLive
    ? `First recording: the game reference (inspiration only, includes game post-processing). Second: the live take of the line below, what players hear now: the target, which the next version should sound like except where the notes ask otherwise. Third: the same line in ${v}.`
    : `First recording: the game reference (inspiration only, includes game post-processing). Second: the line below in ${v}. This line has no live take.`;
  return `You are a casting director revising a designed voice for ${input.slot} (World of Warcraft NPCs; who uses it: ${input.archetype || "(unknown)"}).
${v}'s verdict: ${input.status}.

History of ${input.slot}, oldest first: each version and its verdicts. Reviewer's notes and players' notes the reviewer picked say what the reviewer WANTS. Observations by Gemini or Claude describe how that version's take sounded next to the live take, the state it was in: never follow one as an instruction ("slower and breathier" observed means the voice was slower and breathier than the live take, which is usually what the reviewer wants fixed).
${input.history.flatMap((entry) => historyLines(entry, input.version)).join("\n")}

How to use the history:
- Satisfy every open note, from every version, not only ${v}'s.
- When notes conflict, the newer note wins.
- Never reintroduce a problem an earlier note asked to fix, or one fixed by a version marked good. A note is also satisfied when a later note says so ("the accent is right now").
- Keep what the notes praise and what nobody complained about.
- An older reviewer's note that only describes how the voice sounds next to the live take ("lower energy than the live take") may be an observation pasted in as a note. Where it contradicts the reviewer's own wishes, the wishes win.

Notes on the race's other flavors. Each is about its own slot: only race-wide points (the accent, what makes the race sound like itself) apply to ${input.slot}. Slot-specific points (pace, pitch, age, energy, attitude, "too slow") do not transfer.
${siblings}

The ${v} prompt was: "${input.prompt}"
${v} preview text: "${input.previewText}"
${recordings}
The line, as sent to ${v} (square-bracketed words are performance directions, not speech): "${input.line}"${
    input.numbers
      ? `\nMeasurements of the three recordings (openSMILE eGeMAPS means; compare the columns rather than reading absolute values; game audio is processed). Lower F1/F2/F3 mean a bigger body and rounder vowels; high H1-H2 is breathy; low HNR is rough:\n${input.numbers}`
      : ""
  }
Rewrite the ElevenLabs Voice Design prompt (text only, 350-600 characters) so the next version satisfies the open notes.
- Put the accent early and make it explicit and strong when the race needs one ("with a thick Scottish accent").
- State the gender explicitly ("unmistakably masculine/feminine"). For male voices asked to be nasal or higher, keep a clear masculine anchor (adult man, baritone or tenor chest voice).
- Avoid modern inflections (upspeak, vocal fry, valley/Californian) unless the role demands them: this is a fantasy game.
${DRAFTING_RULES}
Also return a preview_text (120-400 characters, in the character's normal register; keep the old one unless it fights the notes).
Also return changes: the same fix said only as changes to the ${v} voice, for ElevenLabs Voice Remix, which keeps the voice and alters what you name (20-300 characters, e.g. "Add a thick Scottish accent. Keep the timbre, age and pace."). Name what to keep when the reviewer liked it.
Return JSON only: {"heard": "one sentence: how the ${v} voice departs from the live take, and which open notes it still misses", "prompt": "...", "preview_text": "...", "changes": "..."}`;
}

/** Revise a version: Gemini hears the game reference, the line's live take if any, and the line in the version. */
export async function reviseVoice(
  input: Omit<ReviseInput, "hasLive"> & { apiKey: string; reference: Buffer; live: Buffer | null; sample: Buffer } & GeminiOptions,
): Promise<Revision> {
  const audio = [input.reference, ...(input.live ? [input.live] : []), input.sample].map(audioPart);
  const answer = (await generateJson({
    ...input,
    parts: [{ text: buildRevisePrompt({ ...input, hasLive: input.live !== null }) }, ...audio],
  })) as Partial<Revision> | null;
  if (typeof answer?.prompt !== "string" || typeof answer.preview_text !== "string") {
    throw new Error("Gemini returned no prompt or preview text");
  }
  return {
    heard: typeof answer.heard === "string" ? answer.heard : "",
    prompt: withEnding(answer.prompt),
    preview_text: answer.preview_text.trim(),
    changes: typeof answer.changes === "string" ? answer.changes.trim() : "",
  };
}

/** How much an aspect's difference matters for directing the voice. */
export type Weight = "high" | "medium" | "low";

export const WEIGHTS: readonly Weight[] = ["high", "medium", "low"];

export type Aspect = { aspect: string; live: string; new: string; reference?: string; matters?: Weight };

export type Difference = {
  summary: string;
  /** The difference that matters most, as an observation of how the new voice sounds. */
  note: string;
  /** The same point as what the next version should do: the reviewer edits it into the note. */
  wish: string;
  aspects: Aspect[];
};

/**
 * Told only "compare", a judge treats the game reference as the ideal and finds the live take
 * lacking. The live take is what the team chose; the reference only says what kind of character it is.
 */
export const TARGET_RULE = `The live take is the target: it is how this character should sound, and the designed version should sound like it. Judge the designed version against it. Never criticise the live take or say it lacks anything. The game reference is the original actor, processed by the game: background only, for what kind of character this is. Where the reference and the live take differ, the live take wins: never ask the designed version for something the live take does not have.`;

/**
 * What a voice director listens for, named one by one: a listener asked only for "the differences"
 * reports timbre and pitch and skips accent, cadence and delivery.
 */
export const DIRECTION_ASPECTS = [
  "accent: which one, how strong, and whether it holds through the line or fades",
  "pronunciation of names and fantasy words",
  "cadence and phrasing: where the pauses fall and how long, drawl or clipped, run-on or measured",
  "intonation: the pitch contour, phrase ends rising or falling, monotone or sing-song",
  "emphasis: which words are stressed and how hard",
  "emotional tone and subtext",
  "persona: who this sounds like (authority, menace, warmth, age, status)",
  "delivery style: acted or read, theatrical or natural, intimate or projected",
  "gender and apparent age",
  "pitch, timbre and texture (rasp, breath, nasality)",
  "resonance and body size",
  "pace and energy",
  "recording quality",
] as const;

export function buildDifferencePrompt(input: { slot: string; version: number; text: string; hasReference: boolean }): string {
  const v = `v${input.version}`;
  const recordings = input.hasReference
    ? `First recording: the original game voice for this kind of character (the reference: other lines, processed by the game). Second: the live take players hear in the game now. Third: the same line as the second, in designed voice ${v}.`
    : `First recording: the live take players hear in the game now. Second: the same line in designed voice ${v}.`;
  return `You are a voice director. You will hear recordings for ${input.slot} (World of Warcraft NPCs).
${recordings}
${TARGET_RULE}
The line, as sent to ${v} (square-bracketed words are performance directions, not speech): "${input.text}"
Say how ${v} departs from the live take, so a voice designer knows what to change to bring it closer. Go through each of these, as a director would:
${DIRECTION_ASPECTS.map((aspect) => `- ${aspect}`).join("\n")}
Leave out an aspect only where they sound the same. Be concrete ("the Scottish accent fades after the first sentence", not "the accent differs"; "every phrase ends rising, like a question", not "different intonation").
For each aspect, say how much the difference matters for directing this character: high, medium or low. Order the aspects from the one that matters most.
Also write note: the one difference that matters most, as an observation of how v${input.version} sounds next to the live take (not a wish), under 80 characters, lowercase, no full stop ("scottish accent fades after the first words", "sounds younger and thinner").
And wish: the same point said as what the next version should do to come closer to the live take, under 80 characters, lowercase, no full stop ("keep the scottish accent strong throughout", "older and fuller").
Return JSON only: {"summary": "one or two sentences: the differences that matter most", "note": "...", "wish": "...", "aspects": [{"aspect": "...", "reference": "${input.hasReference ? "how the reference sounds, only where it explains the live take; else empty" : ""}", "live": "how the live take sounds", "new": "how v${input.version} sounds", "matters": "high|medium|low"}]}`;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** A judge's aspects, checked: ones missing a side are dropped, an empty reference or unknown weight left out. */
export function parseAspects(value: unknown): Aspect[] {
  return (Array.isArray(value) ? (value as Record<string, unknown>[]) : [])
    .filter((a) => text(a?.aspect) && typeof a.live === "string" && typeof a.new === "string")
    .map((a) => ({
      aspect: text(a.aspect),
      live: text(a.live),
      new: text(a.new),
      ...(text(a.reference) ? { reference: text(a.reference) } : {}),
      ...(WEIGHTS.includes(a.matters as Weight) ? { matters: a.matters as Weight } : {}),
    }));
}

/** Gemini hears the reference if there is one, the live take, then the version's take of one line. */
export async function describeDifference(
  input: { apiKey: string; slot: string; version: number; text: string; reference: Buffer | null; live: Buffer; sample: Buffer } & GeminiOptions,
): Promise<Difference> {
  const audio = [...(input.reference ? [input.reference] : []), input.live, input.sample].map(audioPart);
  const answer = (await generateJson({
    ...input,
    parts: [{ text: buildDifferencePrompt({ ...input, hasReference: input.reference !== null }) }, ...audio],
  })) as Partial<Difference> | null;
  if (typeof answer?.summary !== "string") throw new Error("Gemini returned no summary of the difference");
  return { summary: answer.summary.trim(), note: text(answer.note), wish: text(answer.wish), aspects: parseAspects(answer.aspects) };
}
