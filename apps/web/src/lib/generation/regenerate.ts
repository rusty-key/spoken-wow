/**
 * Regenerating one line, end to end.
 *
 * Everything the route does apart from authentication, kept out of the route so it can be
 * read in one piece: resolve the line, refuse the cases that cannot work, take the lock,
 * spend the characters, commit the take.
 *
 * The order of the refusals matters. Each one avoids spending money on a request that was
 * always going to fail, and the cheapest checks come first - a line that is never voiced, or
 * a voice that does not exist, costs nothing to detect and would otherwise cost a request.
 *
 * What gets spoken is the override if there is one and the corpus text otherwise, and that
 * choice is made before the refusals rather than after: whether a line can be voiced at all is
 * a property of the text that will be sent. The corpus's `generatable` flag cannot answer it,
 * having been computed in Python from text that nobody could edit yet.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import { audioRelPath } from "@/lib/audio";
import type { CorpusLine } from "@/lib/corpus";
import { lineIndex } from "@/lib/quests/catalogue";
import { readIgnores } from "@/lib/quests/ignores";
import { readOverrides } from "@/lib/quests/overrides";
import { commitTake } from "@/lib/takes/commit";
import { INVALID_CHARS, isVoiceable } from "@/lib/text-gate";

import { sentText } from "./files";
import { canonicalNpcId, seedFor } from "./seed";
import { spokenHash } from "./spoken-hash";
import { currentConfig } from "./settings";
import { NARRATOR_VOICE, segments } from "./narration";
import type { Speaker } from "./speakers/speaker";
import { BUSY, withTakeLock } from "./lock";
import { busy, failure, type Failure } from "./errors";
import { SHAPE } from "./speakers/shape";

export type RegenerateSuccess = {
  ok: true;
  lineId: string;
  file: string;
  version: number;
  bytes: number;
  characters: number;
  /** What this cost, exactly, in ElevenLabs credits. null when it did not say. */
  credits: number | null;
  /** What this cost in dollars, for a fish.audio take. */
  costUsd: number | null;
  seed: number | null;
  voice: string;
  voiceId: string;
  /** Text actually spoken, after the pronunciation rules. Shown when it differs. */
  spokenText: string;
  /** The lexicon version applied, or null when no dictionary was in force. */
  dictionaryVersion: string | null;
  /** Other NPCs whose lines resolve to this same file, and who therefore also changed. */
  sharedWith: number;
};

export type RegenerateResult = RegenerateSuccess | { ok: false; failure: Failure };

/**
 * Group the corpus lines that resolve to one lineId.
 *
 * A gossip lineId is g:{md5(text + race + gender)}, so it can name many NPCs at once - they
 * share the text, the voice and the mp3, and differ only in who says it.
 */
async function resolve(lineId: string, lang: Lang): Promise<CorpusLine[] | null> {
  const group = (await lineIndex(lang)).get(lineId);
  return group && group.length > 0 ? group : null;
}

/**
 * `options.lang` is the language to speak the line in: its text (lib/quests/catalogue.ts reads
 * a language over the English lines), its settings, its lexicon, and a take filed under it.
 * English when absent, which is every caller that predates languages.
 */
export async function regenerateLine(
  lineId: string,
  createdBy: string,
  options: { speaker: Speaker; lang?: Lang; batchId?: string },
): Promise<RegenerateResult> {
  const lang = options.lang ?? BASE_LANG;
  const { speaker } = options;
  const group = await resolve(lineId, lang);
  if (!group) {
    return { ok: false, failure: { ...failure("bad-request", `no line ${lineId}`), status: 404 } };
  }

  const line = group[0];
  const file = audioRelPath(line);

  // Before the voiceability gate and before any credit is spent: an ignored line is a
  // decision, not a defect, so no override can rescue it and there is nothing to weigh up.
  // A queued job can outlive the decision, which is exactly why this is checked here rather
  // than only where the queue is filled.
  const ignore = (await readIgnores(lang)).get(lineId);
  if (ignore) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} is ignored: ${ignore.reason}`),
        status: 409,
        fatal: false,
      },
    };
  }

  // Read per line rather than hoisted over a batch, for the reason the dictionary locator is
  // read inside the lock below: someone rewriting a line mid-batch should affect the lines
  // after the save. Read *before* the gate because an override is what decides whether this
  // line is voiceable at all - the corpus's own flag was computed from text nobody could edit.
  //
  // English only: an override rewrites the English corpus. Another language's rewrites are
  // versions of its own text, which `line` already is.
  const overrides = await readOverrides(lang);
  const source = overrides.get(file)?.text ?? line.text;

  if (!isVoiceable(line, source)) {
    const why =
      line.skipReason === "untranslated"
        ? `it has no ${lang} text yet`
        : `its text still holds one of ${INVALID_CHARS} - rewrite it to voice it`;
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} is never voiced: ${why}`),
        status: 409,
        // Not a transient condition, but not a reason to abandon a batch either: the other
        // lines are fine. The client filters these out before starting, so reaching here
        // means the corpus moved under an open page.
        fatal: false,
      },
    };
  }

  // This language's voices: a slot cloned in English has no German voice until German clips
  // are cloned into it.
  const voices = await speaker.voices(lang);
  if (voices.error && voices.ids.size === 0) {
    return { ok: false, failure: failure("auth", voices.error) };
  }

  const voiceId = voices.ids.get(line.voice);
  if (!voiceId) {
    return {
      ok: false,
      failure: failure(
        "voice-missing",
        `${speaker.missing(line.voice)}. Create it on /voices before generating this line.`,
      ),
    };
  }

  const outcome = await withTakeLock("quests", file, async (): Promise<RegenerateResult> => {
    const config = await currentConfig(lang);
    // Inside spokenText and not bolted on at the request, because these are characters the
    // provider bills and the staleness check hashes: a take that under-reported them would
    // be mispriced and permanently stale.
    //
    // The committed pronunciation rules are English's spellings of English words; another
    // language is spoken with its own lexicon, which the speaker applies, and nothing else.
    const spokenText = SHAPE[speaker.provider](
      sentText(source, lang, line.playerGender),
      config.raceTags[line.race],
    );
    // Lowest npcId in the group, so a file shared by many NPCs regenerates the same way
    // whichever row the button was pressed on. See canonicalNpcId.
    const seed = seedFor(canonicalNpcId(group), speaker.seedStrategy);

    // A capitalised <stage direction> is the game narrating, not the NPC talking, so the line
    // is spoken by two voices and the speaker makes one file of the turns. Everything below -
    // seed, dictionary, credit accounting - is identical either way.
    const parts = segments(spokenText);
    const narrated = parts.some((part) => part.speaker === "narrator");

    // Resolved by name, because narrator-male is not a race-gender-flavor slot and so has no
    // corpus line to read it off.
    const narratorVoiceId = narrated ? voices.ids.get(NARRATOR_VOICE) : undefined;
    if (narrated && !narratorVoiceId) {
      return {
        ok: false,
        failure: failure(
          "voice-missing",
          `${speaker.missing(NARRATOR_VOICE)}. Create it on /voices before generating a line with stage directions.`,
        ),
      };
    }

    const speech = await speaker.speak({
      turns: narrated
        ? parts.map((part) => ({
            text: part.text,
            voiceId: part.speaker === "narrator" ? narratorVoiceId! : voiceId,
          }))
        : [{ text: spokenText, voiceId }],
      lang,
      seed,
      dialogue: narrated,
    });
    if (!speech.ok) return { ok: false, failure: speech.failure };

    // Already trimmed of its lead-in by tts.ts, so the archived file and `bytes` both
    // describe the audio the addon will play.
    const committed = await commitTake(
      "quests",
      file,
      speech.audio,
      {
        lineId,
        voice: line.voice,
        narratorVoice: narrated ? NARRATOR_VOICE : null,
        voiceId,
        modelId: speech.made.modelId,
        seed,
        characters: spokenText.length,
        credits: speech.credits,
        provider: speaker.provider,
        costUsd: speech.costUsd,
        settings: speech.made.settings,
        spokenHash: spokenHash(spokenText),
        dictionaryVersion: speech.made.dictionaryVersion,
        leadIn: speech.leadIn,
        leadInSec: speech.leadInSec,
        createdBy,
      },
      { lang, batchId: options.batchId },
    );

    return {
      ok: true,
      lineId,
      file,
      version: committed.version,
      bytes: committed.bytes,
      characters: spokenText.length,
      credits: speech.credits,
      costUsd: speech.costUsd,
      seed,
      voice: line.voice,
      voiceId,
      spokenText,
      dictionaryVersion: speech.made.dictionaryVersion,
      sharedWith: new Set(group.map((l) => `${l.npcType}:${l.npcId}`)).size - 1,
    };
  }, lang);

  if (outcome === BUSY) return { ok: false, failure: busy(file) };
  return outcome;
}
