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
import { corpus } from "@/lib/quests/catalogue";
import { overrideOf } from "@/lib/quests/override";
import { readOverrides } from "@/lib/quests/overrides";
import { audioRelPath } from "@/lib/audio";

import { DesignError } from "./access";
import { keepDesignAudio } from "./audio";
import { found, holderRefusal } from "./design";
import { withDesignLock } from "./lock";
import { defaultSampleLines } from "./lines";
import { readDesign, replaceSamples } from "./store";
import type { Design, DesignSample } from "./types";

export type SampleDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  lines: (lang: Lang) => Promise<readonly CorpusLine[]>;
  /** What the caller's request would send for a line, shaped as regeneration shapes it. */
  shaper: (lang: Lang, settings: ElevenLabsSettings) => Promise<(line: CorpusLine) => string>;
  settings: (userId: string, lang: Lang) => Promise<ElevenLabsSettings>;
  speak: (input: { text: string; voiceId: string; lang: Lang; apiKey: string; settings: ElevenLabsSettings }) => Promise<Spoken>;
  keepAudio: (data: Buffer, lang: Lang) => Promise<string>;
  replace: typeof replaceSamples;
  lock: <T>(id: string, work: () => Promise<T>) => Promise<T>;
};

async function shaper(lang: Lang, settings: ElevenLabsSettings): Promise<(line: CorpusLine) => string> {
  const [config, overrides, npcDirectionOf] = await Promise.all([speakingConfig(settings, lang), readOverrides(lang), npcDirections(lang)]);
  return (line) => {
    const source = overrideOf(overrides, audioRelPath(line))?.text ?? line.text;
    return shapedText(source, lang, line, "elevenlabs", config.raceTags, npcDirectionOf(line));
  };
}

const LIVE: SampleDeps = {
  read: readDesign,
  lines: async (lang) => (await corpus(lang)).lines,
  shaper,
  settings: async (userId, lang) => (await readPreference(userId, lang)).elevenlabs,
  speak: ({ text, voiceId, lang, apiKey, settings }) =>
    elevenLabsSpeaker({ apiKey, settings }).speak({ turns: [{ text, voiceId }], lang, seed: null, dialogue: false }),
  keepAudio: keepDesignAudio,
  replace: replaceSamples,
  lock: withDesignLock,
};

type SampleInput = { lang: Lang; id: string; userId: string; apiKey: string };

/** The holder alone, on their own key: the voice is in their account, and nobody spends a teammate's credits. */
export async function sampleDesign(input: SampleInput, deps: SampleDeps = LIVE): Promise<Design> {
  return deps.lock(input.id, () => sampleLocked(input, deps));
}

async function sampleLocked(input: SampleInput, deps: SampleDeps): Promise<Design> {
  const design = await found(deps.read, input.lang, input.id);
  const refused = holderRefusal(design, input.userId);
  if (refused) throw new DesignError(refused, 403);

  const chosen = defaultSampleLines(await deps.lines(input.lang), design.slot);
  if (chosen.length === 0) throw new DesignError(`${design.slot} has no line to sample`, 409);

  const settings = await deps.settings(input.userId, input.lang);
  const shape = await deps.shaper(input.lang, settings);
  const samples: DesignSample[] = await Promise.all(
    chosen.map(async (line, position) => {
      const text = shape(line);
      const spoken = await deps.speak({ text, voiceId: design.voiceId!, lang: input.lang, apiKey: input.apiKey, settings });
      if (!spoken.ok) throw new Error(`voicing ${line.lineId}: ${spoken.failure.message}`);
      return {
        position,
        sha256: await deps.keepAudio(spoken.audio, input.lang),
        lineId: line.lineId,
        text,
        npcName: line.npcName,
        characters: text.length,
        credits: spoken.credits,
      };
    }),
  );
  await deps.replace(input.lang, input.id, samples, { model: settings.modelId, settings: settings.voiceSettings as Record<string, unknown> });
  return (await deps.read(input.lang, input.id))!;
}
