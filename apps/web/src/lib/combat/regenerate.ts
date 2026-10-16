import "server-only";

import { BASE_LANG } from "@/lib/lang";
import { commitTake } from "@/lib/takes/commit";
import { durationOf } from "@/lib/zones/tools";
import { busy, failure } from "@/lib/generation/errors";
import { sentText } from "@/lib/generation/files";
import { BUSY, withTakeLock } from "@/lib/generation/lock";
import type { RegenerateResult } from "@/lib/generation/regenerate";
import type { Speaker } from "@/lib/generation/speakers/speaker";
import { spokenHash } from "@/lib/generation/spoken-hash";
import { combatLine } from "./catalogue";

export async function regenerateCombatLine(
  lineId: string,
  createdBy: string,
  speaker: Speaker,
): Promise<RegenerateResult> {
  const line = combatLine(lineId);
  if (!line) return { ok: false, failure: { ...failure("bad-request", "Unknown combat line"), status: 404 } };
  const voices = await speaker.voices(BASE_LANG);
  if (voices.error) return { ok: false, failure: failure("auth", voices.error) };
  const voiceId = voices.ids.get(line.voice);
  if (!voiceId) return { ok: false, failure: failure("voice-missing", speaker.missing(line.voice)) };

  // Combat takes share the quests archive and its backup workflow, under their own frozen paths.
  const result = await withTakeLock("quests", line.file, async (): Promise<RegenerateResult> => {
    const spokenText = sentText(line.text, BASE_LANG, null);
    const speech = await speaker.speak({
      turns: [{ text: spokenText, voiceId }], lang: BASE_LANG, seed: null, dialogue: false,
    });
    if (!speech.ok) return speech;
    const committed = await commitTake("quests", line.file, speech.audio, {
      lineId, voice: line.voice, voiceId, createdBy,
      modelId: speech.made.modelId, outputFormat: speech.made.outputFormat,
      settings: speech.made.settings, seed: null,
      provider: speaker.provider, characters: spokenText.length,
      credits: speech.credits, costUsd: speech.costUsd,
      spokenHash: spokenHash(spokenText),
      dictionaryId: speech.made.dictionaryId, dictionaryVersion: speech.made.dictionaryVersion,
      leadIn: speech.leadIn, leadInSec: speech.leadInSec,
    }, { lang: BASE_LANG, measure: durationOf });
    return {
      ok: true, lineId, file: line.file, version: committed.version, bytes: committed.bytes,
      characters: spokenText.length, credits: speech.credits, costUsd: speech.costUsd,
      seed: null, voice: line.voice, voiceId, spokenText,
      dictionaryVersion: speech.made.dictionaryVersion, sharedWith: 0,
    };
  });
  return result === BUSY ? { ok: false, failure: busy(line.file) } : result;
}
