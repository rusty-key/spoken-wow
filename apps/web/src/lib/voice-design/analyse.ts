/**
 * Analyse: a race-gender's flavors, heard blind by Gemini beside openSMILE's measurements.
 *
 * Only game audio already on the site goes out, and only to Gemini and the local helper: never to
 * ElevenLabs, which receives nothing but text.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { corpus } from "@/lib/quests/catalogue";
import { cloneName } from "@/lib/voices/clone-name";
import { cutClip, readReference, readReferenceAudio } from "@/lib/voices/references";
import { listSamples, withSampleFiles } from "@/lib/voices/samples";
import { slots } from "@/lib/voices/slots";

import { DesignError } from "./access";
import { blindLabels, buildPrompt, compareBlind, GEMINI_MODEL } from "./gemini";
import { groupOf } from "./groups";
import { slotNpcs } from "./lines";
import { measureAudio } from "./measure";
import { saveAnalysis, type NewAnalysis } from "./store";
import type { Analysis, GeminiResult, Measures } from "./types";

/** Past thirty seconds of barks a comparison hears nothing new, and only costs upload time. */
const CLIP_SECONDS = 30;

export type AnalyseDeps = {
  slotsOf: (lang: Lang, group: string) => Promise<string[]>;
  gameClip: (slot: string, lang: Lang) => Promise<Buffer | null>;
  npcsOf: (slot: string, lang: Lang) => Promise<string[]>;
  measure: (clips: Buffer[]) => Promise<(Measures | null)[] | null>;
  compare: (input: { apiKey: string; prompt: string; clips: { label: string; audio: Buffer }[] }) => Promise<GeminiResult>;
  save: (input: NewAnalysis) => Promise<Analysis>;
  random: () => number;
};

/** The slot's fish.audio reference window if it has one, else the first 30 seconds of its first clip. */
export async function gameClip(slot: string, lang: Lang): Promise<Buffer | null> {
  const reference = await readReference(slot, lang);
  if (reference) {
    const audio = await readReferenceAudio(slot, lang, reference.sha256);
    if (audio) return audio;
  }
  const clone = cloneName(slot, lang);
  const [first] = await listSamples(clone);
  if (!first) return null;
  return withSampleFiles(clone, [first.file], ([file]) => cutClip(file, 0, CLIP_SECONDS));
}

export const LIVE: AnalyseDeps = {
  slotsOf: async (lang, group) => (await slots(lang)).map((slot) => slot.name).filter((name) => groupOf(name) === group),
  gameClip,
  npcsOf: async (slot, lang) => slotNpcs((await corpus(lang)).lines, slot),
  measure: (clips) => measureAudio(clips),
  compare: (input) => compareBlind(input),
  save: saveAnalysis,
  random: Math.random,
};

export async function analyseGroup(
  input: { lang: Lang; group: string; userId: string; apiKey: string },
  deps: AnalyseDeps = LIVE,
): Promise<{ analysis: Analysis; missing: string[] }> {
  const { lang, group } = input;
  const members = await deps.slotsOf(lang, group);
  const found = await Promise.all(members.map(async (slot) => ({ slot, audio: await deps.gameClip(slot, lang) })));
  const heard = found.filter((entry): entry is { slot: string; audio: Buffer } => entry.audio !== null);
  const missing = found.filter((entry) => entry.audio === null).map((entry) => entry.slot);
  if (heard.length < 2) {
    throw new DesignError(`a comparison needs two flavors with game clips; ${group} has ${heard.length}`);
  }

  const labels = blindLabels(heard.map((entry) => entry.slot), deps.random);
  const order = Object.entries(labels);
  const audioOf = new Map(heard.map((entry) => [entry.slot, entry.audio]));
  const clips = order.map(([label, slot]) => ({ label, audio: audioOf.get(slot)! }));

  const [measured, npcs] = await Promise.all([
    deps.measure(clips.map((clip) => clip.audio)),
    Promise.all(order.map(([, slot]) => deps.npcsOf(slot, lang))),
  ]);
  const measurements = measured
    ? Object.fromEntries(order.flatMap(([label], i) => (measured[i] ? [[label, measured[i]!]] : [])))
    : null;

  const prompt = buildPrompt({
    group,
    flavors: order.map(([label], i) => ({ label, npcs: npcs[i], measures: measurements?.[label] ?? null })),
  });
  const result = await deps.compare({ apiKey: input.apiKey, prompt, clips });
  const analysis = await deps.save({ lang, group, labels, result, measurements, model: GEMINI_MODEL, userId: input.userId });
  return { analysis, missing };
}
