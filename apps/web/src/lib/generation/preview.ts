/**
 * Hearing one lexicon entry before it costs a batch.
 *
 * The trick that makes this possible without uploading anything: every model that honours a
 * dictionary phoneme rule also takes IPA inline in the text, each in its own syntax
 * (PHONEME_SYNTAX). So a draft entry can be spoken while it is still a draft - before it is
 * saved, before a dictionary exists, and without disturbing the one generation is using.
 *
 * What it does NOT prove is worth being clear about, because it is the more common
 * misunderstanding: this renders the SOUND, by substituting it directly. It says nothing
 * about whether the rule would fire - whether matching is really case-insensitive, whether
 * "Azshara's" inherits the rule for "Azshara". Only a request carrying the real dictionary
 * answers that, and this is not one.
 *
 * Cached on disk, keyed by everything that changes the audio. Re-opening an entry, or two
 * admins checking the same name, must not spend credits twice for identical bytes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CorpusLine } from "@/lib/corpus";
import { corpus } from "@/lib/quests/catalogue";
import { PREVIEW_DIR } from "@/lib/paths";
import type { ElevenLabsOptions } from "@/lib/voices/elevenlabs";

import type { GenerationConfig } from "./config";
import { honoursPhonemes, kindOf, phonemeSyntax, type LexiconEntry } from "./lexicon";
import type { PreviewMode } from "./preview-modes";

export { PREVIEW_MODES, isPreviewMode, type PreviewMode } from "./preview-modes";
import { failure, type Failure } from "./errors";
import { textToSpeech } from "./tts";

/**
 * The longest a preview may be.
 *
 * Credits are the reason. A preview exists to check one word, and the corpus contains quest
 * text that runs to a couple of thousand characters - rendering one of those to hear how a
 * name is said would cost more than regenerating the line it came from.
 */
export const MAX_PREVIEW_CHARS = 220;

/** A carrier for names the corpus happens not to use in any short sentence. */
export function carrier(grapheme: string): string {
  // A sentence rather than the bare word: a name in isolation gets list intonation and a
  // final fall, which is not how it will be said in a line, and prosody is half of what
  // someone is listening for when they check a pronunciation.
  return `They say ${grapheme} is not what it once was.`;
}

/** Split into sentences, keeping the terminator so the preview is a whole utterance. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Case-insensitive and word-bounded, matching how the rule itself will match.
 *
 * Escaped, because a grapheme is user input: "C'Thun" contains no metacharacters but the
 * next name someone adds might.
 */
export function bounded(grapheme: string): RegExp {
  const escaped = grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "i");
}

export type Sample = { text: string; line: CorpusLine | null };

/**
 * The shortest real sentence in the corpus that uses each name, or a carrier if none does.
 *
 * A real line beats an invented one: it is the actual context, the actual register, and
 * hearing the name where it will really appear is the whole question. Shortest, because
 * every character is billed and a longer sentence tells you nothing more about one word.
 *
 * Batched over the whole lexicon rather than called per name, because the page needs all of
 * them at once to know which previews are already cached, and 134 separate passes over
 * 17,507 lines is 134 times the work of one. The lower-cased `includes` before the regex is
 * what makes even that one pass cheap: almost every line contains none of these names, and
 * a substring test rejects it far faster than a lookbehind does.
 *
 * Measured at 229ms for the committed lexicon against the real corpus, which is why the
 * results are memoised - see sampleSentences, which is this with the answers remembered.
 */
export function scanSentences(graphemes: string[], lines: CorpusLine[]): Map<string, Sample> {
  const needles = graphemes.map((grapheme) => ({
    grapheme,
    lower: grapheme.toLowerCase(),
    pattern: bounded(grapheme),
  }));

  const best = new Map<string, { text: string; line: CorpusLine }>();

  for (const line of lines) {
    if (!line.generatable) continue;
    const lower = line.text.toLowerCase();

    let split: string[] | null = null;
    for (const needle of needles) {
      if (!lower.includes(needle.lower)) continue;
      // Split lazily and once: most lines that survive the prefilter match one name, and
      // splitting a line nothing matched would be the whole saving thrown away.
      split ??= sentences(line.text);

      for (const sentence of split) {
        if (sentence.length > MAX_PREVIEW_CHARS || !needle.pattern.test(sentence)) continue;
        const current = best.get(needle.grapheme);
        if (!current || sentence.length < current.text.length) {
          best.set(needle.grapheme, { text: sentence, line });
        }
      }
    }
  }

  return new Map(
    graphemes.map((grapheme) => [
      grapheme,
      best.get(grapheme) ?? { text: carrier(grapheme), line: null },
    ]),
  );
}

const samplesKey = Symbol.for("wow-voiceover.preview-samples");
type Memo = { lines: CorpusLine[]; samples: Map<string, Sample> };
type SampleHolder = { [samplesKey]?: Memo };

/**
 * Sample sentences, scanning only for the names not already known.
 *
 * Memoised on globalThis for the reason lineIndex is: the corpus ships inside the release
 * and cannot change under a running server, so an answer is good until the process is
 * replaced. Every view of the editor would otherwise repeat a 229ms scan for a set of names
 * that moves by one entry a week.
 *
 * Only the misses are scanned for, so adding a name costs a pass with one needle rather than
 * a pass with 135.
 *
 * Tied to the identity of the lines it was built from, and discarded when they differ. In
 * production that array is the catalogue's own memo and changes only when the table does,
 * so the check
 * passes; in a test it changes every case, and a sample remembered from a different corpus
 * would be a wrong answer rather than a stale one.
 */
export function sampleSentences(graphemes: string[], lines: CorpusLine[]): Map<string, Sample> {
  const holder = globalThis as SampleHolder;
  let memo = holder[samplesKey];
  if (!memo || memo.lines !== lines) {
    memo = holder[samplesKey] = { lines, samples: new Map() };
  }

  const missing = graphemes.filter((grapheme) => !memo!.samples.has(grapheme));
  if (missing.length > 0) {
    for (const [grapheme, sample] of scanSentences(missing, lines)) {
      memo.samples.set(grapheme, sample);
    }
  }

  return new Map(graphemes.map((grapheme) => [grapheme, memo!.samples.get(grapheme)!]));
}

/** One name's sample. See sampleSentences, which is the same thing for a whole lexicon. */
export function sampleSentence(grapheme: string, lines: CorpusLine[]): Sample {
  return sampleSentences([grapheme], lines).get(grapheme)!;
}

/**
 * An alias replaces the word, as an alias rule does; IPA goes inline in the model's
 * PHONEME_SYNTAX form. Only the first occurrence is touched: one is enough to hear, and every
 * extra tag is billed.
 */
export function speakable(entry: LexiconEntry, sentence: string, modelId: string): string {
  const escaped = entry.grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "i");

  return sentence.replace(pattern, (matched) => {
    if (kindOf(entry) === "alias") return entry.alias!;
    const ipa = entry.ipa!.replace(/"/g, "");
    return phonemeSyntax(modelId) === "slash"
      ? `/${ipa}/`
      : `<phoneme alphabet="ipa" ph="${ipa}">${matched}</phoneme>`;
  });
}

/**
 * Everything that changes the bytes, and nothing that does not.
 *
 * The spoken text rather than the entry, so an IPA edit and an alias edit that happen to
 * produce the same request share a cached file. The voice and the settings are in it because
 * the same phonemes in a different voice are a different preview; `say`, the note and the
 * confidence are not, because none of them reach ElevenLabs.
 */
export function previewKey(input: {
  text: string;
  voiceId: string;
  config: GenerationConfig;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text: input.text,
        voiceId: input.voiceId,
        modelId: input.config.modelId,
        settings: input.config.voiceSettings,
      }),
    )
    .digest("hex");
}

export function previewPath(key: string, dir: string = PREVIEW_DIR): string {
  return path.join(dir, `${key}.mp3`);
}

export type Preview = {
  audio: Buffer;
  mode: PreviewMode;
  /** What was sent, tag and all, so the page can show why it sounds the way it does. */
  spoken: string;
  /** What was read, before the pronunciation was substituted in. The name alone in word mode. */
  sentence: string;
  /** The NPC the sentence came from, or null when it is the invented carrier. */
  source: { npcName: string; lineId: string } | null;
  /** False when this cost credits, true when it came off disk. */
  cached: boolean;
  characters: number;
  credits: number | null;
};

export type PreviewResult = { ok: true; preview: Preview } | { ok: false; failure: Failure };

/**
 * Render one entry, or read back the render from last time.
 *
 * No lock, unlike a regeneration. Two admins previewing the same entry at once may both pay
 * for it and write the same bytes over each other, which is a wasted request rather than a
 * corrupted file - and the alternative, a lock on a cache, would be more machinery than the
 * mistake is worth.
 */
export async function renderPreview(
  entry: LexiconEntry,
  mode: PreviewMode,
  /**
   * Which voice to speak with, given the line the sample came from.
   *
   * A function rather than an id, so the sample can be chosen once. The caller wants the
   * NPC's own voice where the account has it - hearing the name in the voice that will
   * actually say it is the point - and scanning the corpus twice to find that out would cost
   * 17,507 lines of matching per preview.
   */
  pickVoice: (line: CorpusLine | null) => string | null,
  config: GenerationConfig,
  options: ElevenLabsOptions = {},
  dir: string = PREVIEW_DIR,
  /** Re-roll: ignore any cached take and pay for a fresh one. */
  force = false,
): Promise<PreviewResult> {
  // Refused rather than rendered. Inline IPA is honoured by exactly the models a dictionary
  // phoneme rule is, so on any other model this would come back sounding like the
  // default pronunciation - and someone checking their IPA would conclude they had written
  // it wrong, and "fix" a transcription that was right. A respelling has no such problem: it
  // is plain text, and every model reads it.
  if (kindOf(entry) === "ipa" && !honoursPhonemes(config.modelId)) {
    return { ok: false, failure: MODEL_IGNORES_PHONEMES(config.modelId) };
  }

  // The corpus scan is skipped entirely in word mode. It is a match against 17,507 lines,
  // and in word mode there is nothing to find: the text is the name.
  const { text: sentence, line }: Sample =
    mode === "word"
      ? { text: entry.grapheme, line: null }
      : sampleSentence(entry.grapheme, (await corpus()).lines);

  const spoken = speakable(entry, sentence, config.modelId);
  const source = line ? { npcName: line.npcName, lineId: line.lineId } : null;

  const voiceId = pickVoice(line);
  if (!voiceId) return { ok: false, failure: NO_VOICE };

  const key = previewKey({ text: spoken, voiceId, config });
  const file = previewPath(key, dir);

  if (!force && fs.existsSync(file)) {
    return {
      ok: true,
      preview: {
        audio: fs.readFileSync(file),
        mode,
        spoken,
        sentence,
        source,
        cached: true,
        characters: spoken.length,
        // Unknown rather than zero: this take cost whatever it cost when it was first made,
        // and reporting 0 would quietly understate what the page has spent.
        credits: null,
      },
    };
  }

  const speech = await textToSpeech(
    {
      voiceId,
      text: spoken,
      modelId: config.modelId,
      voiceSettings: config.voiceSettings,
      // No seed. A preview is a question about phonemes, and pinning it to an NPC's draw
      // would tie the answer to whichever NPC happened to say the sample sentence.
      seed: null,
    },
    options,
  );
  if (!speech.ok) return { ok: false, failure: speech.failure };

  // Written after the request succeeded, so a failure never leaves a truncated mp3 that the
  // next preview would serve from cache as though it were real audio.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, speech.audio);

  return {
    ok: true,
    preview: {
      audio: speech.audio,
      mode,
      spoken,
      sentence,
      source,
      cached: false,
      characters: spoken.length,
      credits: speech.credits,
    },
  };
}

export type CacheState = Record<PreviewMode, boolean>;

/**
 * Which previews already exist on disk, for the whole lexicon at once.
 *
 * The page needs this before anything is clicked: a button that cannot say whether it will
 * cost money is a button nobody wants to press. Keyed by grapheme, matching what the editor
 * has in hand.
 *
 * Silent about entries with no pronunciation yet, and about the model refusing IPA - those
 * are simply not cached, which is true, and the refusal is the preview's own job to report.
 */
export async function previewCache(
  entries: LexiconEntry[],
  // May be still on its way: the account's voices come from ElevenLabs, and the corpus need
  // not wait for them.
  picker: VoicePicker | Promise<VoicePicker>,
  config: GenerationConfig,
  dir: string = PREVIEW_DIR,
): Promise<Record<string, CacheState>> {
  const [{ lines }, pickVoice] = await Promise.all([corpus(), picker]);
  const samples = sampleSentences(
    entries.map((entry) => entry.grapheme),
    lines,
  );

  const cache: Record<string, CacheState> = {};
  for (const entry of entries) {
    if (!entry.grapheme || !(entry.ipa ?? entry.alias)) continue;
    const sample = samples.get(entry.grapheme)!;

    cache[entry.grapheme] = {
      word: exists(entry, entry.grapheme, null),
      sentence: exists(entry, sample.text, sample.line),
    };
  }
  return cache;

  function exists(entry: LexiconEntry, text: string, line: CorpusLine | null): boolean {
    const voiceId = pickVoice(line);
    if (!voiceId) return false;
    return fs.existsSync(
      previewPath(previewKey({ text: speakable(entry, text, config.modelId), voiceId, config }), dir),
    );
  }
}

/** Reported when the configured model would silently ignore the IPA this preview relies on. */
export const MODEL_IGNORES_PHONEMES = (modelId: string): Failure => ({
  ...failure(
    "bad-request",
    `${modelId} ignores phoneme rules, so a preview of this entry would play the default ` +
      `pronunciation rather than the IPA. Switch the model on /voices, or give this entry a ` +
      `respelling instead.`,
  ),
  status: 409,
});

/** Reported when the account has no voice to speak with. */
export const NO_VOICE = failure(
  "voice-missing",
  "no ElevenLabs voice exists yet, so there is nothing to preview with. Create one on /voices.",
);

/**
 * The NPC's own voice where the account has it, otherwise any voice at all.
 *
 * Falling back rather than refusing: a preview is about phonemes, and hearing them in the
 * wrong voice is far more useful than a page that cannot preview anything until all 20
 * voices exist.
 */
type VoicePicker = (line: CorpusLine | null) => string | null;

export function voicePicker(voiceIds: Map<string, string>): VoicePicker {
  return (line) =>
    (line && voiceIds.get(line.voice)) ?? voiceIds.values().next().value ?? null;
}
