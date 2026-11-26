/**
 * Gemini, which listens to a race-gender's game clips side by side on /voices/design.
 *
 * Reached over REST with the caller's own key, like ElevenLabs. `fetchImpl` is injectable so no
 * test spends anything.
 */
import type { GeminiResult } from "./types";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiOptions = { fetchImpl?: typeof globalThis.fetch; baseUrl?: string };

async function failure(response: Response, what: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${what} failed (${response.status}): ${body.slice(0, 300)}`);
}

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

/** Three clips of game barks are a few megabytes; Gemini listening to them takes a while. */
const COMPARE_TIMEOUT_MS = 300_000;

/** Letters for the recordings, shuffled, so the order never hints which flavor is which. */
export function blindLabels(slots: readonly string[], random: () => number = Math.random): Record<string, string> {
  const shuffled = [...slots];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(shuffled.map((slot, index) => [String.fromCharCode(65 + index), slot]));
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
  attitude, and what the voice is NOT if a word could pull it the wrong way; accent and consonants.
  Describe no effects. End with exactly: "Perfect audio quality, dry close-mic studio recording, no reverb or effects."
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

/** Gemini's blind comparison of the clips. Throws on any answer not about exactly these labels. */
export async function compareBlind(
  input: { apiKey: string; prompt: string; clips: { label: string; audio: Buffer }[] } & GeminiOptions,
): Promise<GeminiResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const parts: unknown[] = [{ text: input.prompt }];
  for (const clip of input.clips) {
    parts.push({ text: `Recording ${clip.label}:` }, { inline_data: { mime_type: "audio/mpeg", data: clip.audio.toString("base64") } });
  }
  const response = await fetchImpl(`${input.baseUrl ?? GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(COMPARE_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "Gemini's comparison");

  const body = (await response.json()) as Candidate;
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  let result: GeminiResult;
  try {
    result = JSON.parse(text) as GeminiResult;
  } catch {
    throw new Error(`Gemini did not answer in JSON: ${text.slice(0, 200)}`);
  }
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
  }
  return result;
}
