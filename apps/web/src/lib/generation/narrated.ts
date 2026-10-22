/**
 * Narrating one line in a section read by the single narrator: zones and books.
 *
 * Both sections voice every line with the one narrator, the generating collaborator's own
 * settings and the pronunciation lexicon, give every line a file of its own, and record a duration --
 * so everything from resolving that narrator to committing the take is the same, and was
 * written twice until a new take field (the lead-in) had to be added to both copies. What
 * stays in each section is what is actually about it: how a line is found and whether it
 * can be voiced at all.
 *
 * The result is a RegenerateResult rather than an exception because the worker decides
 * what to do next from `kind` and `fatal`: running out of credits fails every remaining
 * line identically and stops the batch, while one line that cannot be voiced is one line.
 *
 * THE REQUEST ITSELF IS the Speaker's (./speakers), the same one quests narrates through.
 *
 * The narrator is the `narrator-male` slot on /voices, resolved by name against the account
 * the request is spending from. It is the same roster entry the quests side narrates its
 * stage directions with; the two were always the same voice on the same account, and only
 * the zones site's old config file made them look separate. The model and settings are the
 * collaborator's own and the lexicon the language's, the same for both sections, so a
 * narrator is never cut with a different model from the NPC beside it without somebody
 * choosing that.
 */
import { BASE_LANG } from "@/lib/lang";
import "server-only";

import { commitTake } from "@/lib/takes/commit";
import { durationOf } from "@/lib/zones/tools";

import { busy, failure } from "./errors";
import { BUSY, withTakeLock } from "./lock";
import { NARRATOR_VOICE } from "./narration";
import type { RegenerateResult } from "./regenerate";
import type { Speaker, Spoken } from "./speakers/speaker";
import { timesFor } from "./word-times";
import type { Lang } from "@/lib/lang";

/** What a section hands over once it has found a line and decided it can be voiced. */
export type NarratedLine = {
  /** The id the caller asked for, echoed in the result. */
  lineId: string;
  file: string;
  /** The text as it will be spoken, after the pronunciation rules. */
  spoken: string;
  /** The text as the addon shows it, which the take's word times are counted against. */
  shown: string;
  /** The section's hash of `spoken`, which staleness compares against. */
  hash: string;
};

/** Anything thrown on the way to a take is reported as a failure, never let out. */
function asFailure(error: unknown) {
  return failure("upstream", error instanceof Error ? error.message : String(error));
}

export async function regenerateNarrated(
  source: "zones" | "books",
  line: NarratedLine,
  createdBy: string,
  options: { speaker: Speaker; lang?: Lang; batchId?: string },
): Promise<RegenerateResult> {
  const lang = options.lang ?? BASE_LANG;
  const { speaker } = options;

  // Each language has its own narrator, like every other voice.
  const voices = await speaker.voices(lang);
  const voiceId = voices.ids.get(NARRATOR_VOICE);
  if (!voiceId) {
    return {
      ok: false,
      failure: failure(
        "voice-missing",
        `${speaker.missing(NARRATOR_VOICE)} on this account. ` +
          "Create it on /voices before generating zone lore.",
      ),
    };
  }

  // Held across the request, not just the write: two requests for one line must not both
  // spend credits, and a restore must not interleave with the commit.
  const outcome = await withTakeLock(source, line.file, async (): Promise<RegenerateResult> => {
    // No seed: a line is narrated once and re-rolled by hand if it comes out wrong, so
    // there is nothing to reproduce bit for bit.
    //
    // Caught because the settings and lexicon are read in here, and a database that will
    // not answer is one line's failure for the worker to weigh, not an exception.
    let speech: Spoken;
    try {
      speech = await speaker.speak({
        turns: [{ text: line.spoken, voiceId }],
        lang,
        seed: null,
        dialogue: false,
      });
    } catch (error) {
      return { ok: false, failure: asFailure(error) };
    }
    if (!speech.ok) return { ok: false, failure: speech.failure };
    // Already trimmed of its lead-in: what is written here is what the addon plays.
    const { audio, credits, costUsd, made } = speech;

    try {
      const committed = await commitTake(
        source,
        line.file,
        audio,
        {
          lineId: line.lineId,
          voiceId,
          modelId: made.modelId,
          outputFormat: made.outputFormat,
          // Unlike an imported take, this one knows exactly what it was made with, so a
          // version that sounded right can be reproduced after the settings have moved on.
          settings: made.settings,
          characters: line.spoken.length,
          credits,
          provider: speaker.provider,
          costUsd,
          spokenHash: line.hash,
          dictionaryId: made.dictionaryId,
          dictionaryVersion: made.dictionaryVersion,
          leadIn: speech.leadIn,
          leadInSec: speech.leadInSec,
          createdBy,
          wordTimes: speech.words ? timesFor(line.shown, speech.words) : null,
        },
        { lang, measure: durationOf, batchId: options.batchId },
      );

      return {
        ok: true,
        lineId: line.lineId,
        file: line.file,
        version: committed.version,
        bytes: committed.bytes,
        characters: line.spoken.length,
        credits,
        costUsd,
        // No seed. The quests side derives one per NPC so a file shared by several of them
        // regenerates the same way whichever row the button was pressed on; here every line
        // has a file of its own and one narrator, so there is nothing to hold steady.
        seed: null,
        voice: NARRATOR_VOICE,
        voiceId,
        dictionaryVersion: made.dictionaryVersion,
        spokenText: line.spoken,
        // Nothing else plays this file: every line has its own, which is the whole
        // difference from a quests gossip file named after its text.
        sharedWith: 0,
      };
    } catch (error) {
      return { ok: false, failure: asFailure(error) };
    }
  }, lang);

  return outcome === BUSY ? { ok: false, failure: busy(line.file) } : outcome;
}
