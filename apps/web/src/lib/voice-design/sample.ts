/**
 * Sample: three corpus lines in a designed voice, made the way regeneration would make them for
 * the caller (their ElevenLabs settings, the language's accent tags and shaping), so a version is
 * judged by what it would really sound like. Kept beside the version, never committed as takes.
 */
import "server-only";

import type { CorpusLine } from "@/lib/corpus";
import { shapedText } from "@/lib/generation/files";
import { npcDirections } from "@/lib/generation/npc-direction";
import { readPreference, speakingConfig, type ElevenLabsSettings } from "@/lib/generation/preference";
import { elevenLabsSpeaker } from "@/lib/generation/speakers/elevenlabs";
import type { Spoken } from "@/lib/generation/speakers/speaker";
import type { Lang } from "@/lib/lang";
import { corpus, lineIndex } from "@/lib/quests/catalogue";
import { overrideOf } from "@/lib/quests/override";
import { readOverrides } from "@/lib/quests/overrides";
import { audioRelPath } from "@/lib/audio";

import { DesignError } from "./access";
import { keepDesignAudio } from "./audio";
import { holderRefusal } from "./design";
import { withDesignLock } from "./lock";
import { defaultSampleLines, soloLine } from "./lines";
import { readDesign, replaceSamples } from "./store";
import type { Design, DesignSample } from "./types";

export const MAX_SAMPLES = 3;

export type SampleDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  /** The slot's lines to choose from, and the lines asked for by id. */
  lines: (lang: Lang) => Promise<{ all: readonly CorpusLine[]; byId: (lineId: string) => CorpusLine | undefined }>;
  /** What the caller's request would send for this line, shaped as regeneration shapes it. */
  shape: (line: CorpusLine, lang: Lang, settings: ElevenLabsSettings) => Promise<string>;
  settings: (userId: string, lang: Lang) => Promise<ElevenLabsSettings>;
  speak: (input: { text: string; voiceId: string; lang: Lang; apiKey: string; settings: ElevenLabsSettings }) => Promise<Spoken>;
  keepAudio: (data: Buffer, lang: Lang) => Promise<string>;
  replace: typeof replaceSamples;
  lock: <T>(id: string, work: () => Promise<T>) => Promise<T>;
};

async function shape(line: CorpusLine, lang: Lang, settings: ElevenLabsSettings): Promise<string> {
  const [config, overrides, npcDirectionOf] = await Promise.all([speakingConfig(settings, lang), readOverrides(lang), npcDirections(lang)]);
  const source = overrideOf(overrides, audioRelPath(line))?.text ?? line.text;
  return shapedText(source, lang, line, "elevenlabs", config.raceTags, npcDirectionOf(line));
}

const LIVE: SampleDeps = {
  read: readDesign,
  lines: async (lang) => {
    const [{ lines }, index] = await Promise.all([corpus(lang), lineIndex(lang)]);
    return { all: lines, byId: (lineId) => index.get(lineId)?.[0] };
  },
  shape,
  settings: async (userId, lang) => (await readPreference(userId, lang)).elevenlabs,
  speak: ({ text, voiceId, lang, apiKey, settings }) =>
    elevenLabsSpeaker({ apiKey, settings }).speak({ turns: [{ text, voiceId }], lang, seed: null, dialogue: false }),
  keepAudio: keepDesignAudio,
  replace: replaceSamples,
  lock: withDesignLock,
};

/** The holder alone, on their own key: the voice is in their account, and nobody spends a teammate's credits. */
export async function sampleDesign(
  input: { lang: Lang; id: string; lineIds: string[] | null; userId: string; apiKey: string },
  deps: SampleDeps = LIVE,
): Promise<Design> {
  return deps.lock(input.id, () => sampleLocked(input, deps));
}

async function sampleLocked(
  input: { lang: Lang; id: string; lineIds: string[] | null; userId: string; apiKey: string },
  deps: SampleDeps,
): Promise<Design> {
  const design = await deps.read(input.lang, input.id);
  if (!design) throw new DesignError("no such design", 404);
  const refused = holderRefusal(design, input.userId);
  if (refused) throw new DesignError(refused, 403);

  const { all, byId } = await deps.lines(input.lang);
  let chosen: CorpusLine[];
  if (input.lineIds && input.lineIds.length > 0) {
    if (input.lineIds.length > MAX_SAMPLES) throw new DesignError(`at most ${MAX_SAMPLES} lines`, 400);
    chosen = input.lineIds.map((lineId) => {
      const line = byId(lineId);
      if (!line || !soloLine(line, design.slot)) throw new DesignError(`${lineId} is not a line ${design.slot} speaks alone`, 400);
      return line;
    });
  } else {
    chosen = defaultSampleLines(all, design.slot);
  }
  if (chosen.length === 0) throw new DesignError(`${design.slot} has no line to sample`, 409);

  const settings = await deps.settings(input.userId, input.lang);
  const samples: DesignSample[] = [];
  for (const [position, line] of chosen.entries()) {
    const text = await deps.shape(line, input.lang, settings);
    const spoken = await deps.speak({ text, voiceId: design.voiceId!, lang: input.lang, apiKey: input.apiKey, settings });
    if (!spoken.ok) throw new Error(`voicing ${line.lineId}: ${spoken.failure.message}`);
    samples.push({
      position,
      sha256: await deps.keepAudio(spoken.audio, input.lang),
      lineId: line.lineId,
      text,
      npcName: line.npcName,
      characters: text.length,
      credits: spoken.credits,
    });
  }
  await deps.replace(input.lang, input.id, samples, { model: settings.modelId, settings: settings.voiceSettings as Record<string, unknown> });
  return (await deps.read(input.lang, input.id))!;
}
