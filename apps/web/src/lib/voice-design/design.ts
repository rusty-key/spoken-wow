/**
 * Design and Save: Voice Design's three previews for a prompt and preview text, kept and measured,
 * then one of them saved into the caller's ElevenLabs account. Only text goes to ElevenLabs.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import {
  createDesignedVoice,
  deleteVoice,
  designPreviews,
  listAccountVoices,
  remixPreviews,
  type RemixOptions,
  type AccountVoice,
  type DesignedPreview,
} from "@/lib/voices/elevenlabs";
import { isVoiceSlot } from "@/lib/voices/slots";

import { DesignError } from "./access";
import { keepDesignAudio } from "./audio";
import { designName, previewTextProblem, promptLengthProblem, REMIX_CHANGES_MAX, withEnding, type RemixSettings } from "./limits";
import { withDesignLock } from "./lock";
import { measureAudio } from "./measure";
import { createDesign, isOwnAnalysis, listDesigns, markVoiceDeleted, readDesign, saveVoice, SHOWN_REFUSAL, type NewDesign } from "./store";
import type { Design, Measures } from "./types";

export type DesignDeps = {
  isSlot: (slot: string, lang: Lang) => Promise<boolean>;
  isOwnAnalysis: (lang: Lang, id: string) => Promise<boolean>;
  design: (input: { prompt: string; text: string }, apiKey: string) => Promise<DesignedPreview[]>;
  remix: (input: { voiceId: string; changes: string; text: string } & RemixOptions, apiKey: string) => Promise<DesignedPreview[]>;
  keepAudio: (data: Buffer, lang: Lang) => Promise<string>;
  measure: (clips: Buffer[]) => Promise<(Measures | null)[] | null>;
  create: (input: NewDesign) => Promise<Design>;
  read: (lang: Lang, id: string) => Promise<Design | null>;
  slotDesigns: (lang: Lang, slot: string) => Promise<Design[]>;
  save: typeof saveVoice;
  createVoice: (input: { name: string; prompt: string; generatedVoiceId: string }, apiKey: string) => Promise<string>;
  accountVoices: (apiKey: string) => Promise<AccountVoice[]>;
  deleteVoice: (voiceId: string, apiKey: string) => Promise<void>;
  markDeleted: (lang: Lang, id: string) => Promise<void>;
  lock: <T>(id: string, work: () => Promise<T>) => Promise<T>;
};

const LIVE: DesignDeps = {
  isSlot: isVoiceSlot,
  isOwnAnalysis,
  design: (input, apiKey) => designPreviews(input, { apiKey }),
  remix: (input, apiKey) => remixPreviews(input, { apiKey }),
  keepAudio: keepDesignAudio,
  measure: (clips) => measureAudio(clips),
  create: createDesign,
  read: readDesign,
  slotDesigns: listDesigns,
  save: saveVoice,
  createVoice: (input, apiKey) => createDesignedVoice(input, { apiKey }),
  accountVoices: (apiKey) => listAccountVoices({ apiKey }),
  deleteVoice: (voiceId, apiKey) => deleteVoice(voiceId, { apiKey }),
  markDeleted: markVoiceDeleted,
  lock: withDesignLock,
};

/** Long enough for any honest description; these arrive in the request, not from Gemini directly. */
const MAX_DESCRIPTION = 1000;

function describedBy(heard: string | null | undefined, archetype: string | null | undefined): Record<string, string> | null {
  const analysis: Record<string, string> = {};
  if (heard) analysis.revision_heard = heard.slice(0, MAX_DESCRIPTION);
  if (archetype) analysis.archetype = archetype.slice(0, MAX_DESCRIPTION);
  return Object.keys(analysis).length > 0 ? analysis : null;
}

export function rejectDesign(prompt: string, previewText: string): string | null {
  return promptLengthProblem(prompt) ?? previewTextProblem(previewText);
}

/** A new version, and the older ones whose voices it freed from the caller's account. */
export type Made = { design: Design; retired: Design[] };

export async function designVersion(
  input: {
    lang: Lang;
    slot: string;
    prompt: string;
    previewText: string;
    analysisId: string | null;
    /** What Gemini heard when it drafted this version from a review, and who the voice is for. */
    revisionHeard?: string | null;
    archetype?: string | null;
    userId: string;
    apiKey: string;
  },
  deps: DesignDeps = LIVE,
): Promise<Made> {
  // The ending keeps s sounds soft, so no prompt reaches ElevenLabs without it, whoever wrote it.
  const prompt = withEnding(input.prompt);
  const previewText = input.previewText.trim();
  const rejected = rejectDesign(input.prompt, previewText);
  if (rejected) throw new DesignError(rejected, 400);
  if (!(await deps.isSlot(input.slot, input.lang))) throw new DesignError(`no voice slot ${input.slot}`, 404);
  if (input.analysisId !== null && !(await deps.isOwnAnalysis(input.lang, input.analysisId))) {
    throw new DesignError("no such analysis", 400);
  }

  const made = await deps.design({ prompt, text: previewText }, input.apiKey);
  const design = await deps.create({
    lang: input.lang,
    slot: input.slot,
    prompt,
    previewText,
    previews: await keptPreviews(made, input.lang, deps),
    analysisId: input.analysisId,
    analysis: describedBy(input.revisionHeard, input.archetype),
    userId: input.userId,
  });
  return { design, retired: await retireOlder({ ...input, kept: design }, deps) };
}

async function keptPreviews(made: DesignedPreview[], lang: Lang, deps: DesignDeps) {
  const [shas, measured] = await Promise.all([
    Promise.all(made.map((preview) => deps.keepAudio(preview.audio, lang))),
    deps.measure(made.map((preview) => preview.audio)),
  ]);
  return made.map((preview, i) => ({ generatedVoiceId: preview.generatedVoiceId, sha256: shas[i], measures: measured?.[i] ?? null }));
}

/**
 * The next version as a Voice Remix of this one: the voice is kept and only the changes are made.
 * Its prompt is the whole new description (Gemini's rewrite, or the form's), so everything that
 * reads a version's prompt reads this voice. Only the holder may remix, on their own key.
 */
export async function remixVersion(
  input: {
    lang: Lang;
    id: string;
    changes: string;
    prompt: string;
    previewText: string;
    settings: RemixSettings;
    revisionHeard?: string | null;
    archetype?: string | null;
    userId: string;
    apiKey: string;
  },
  deps: DesignDeps = LIVE,
): Promise<Made> {
  const changes = input.changes.trim();
  const prompt = withEnding(input.prompt);
  const previewText = input.previewText.trim();
  if (!changes || changes.length > REMIX_CHANGES_MAX) throw new DesignError(`the changes must be 1 to ${REMIX_CHANGES_MAX} characters`, 400);
  const rejected = rejectDesign(input.prompt, previewText);
  if (rejected) throw new DesignError(rejected, 400);
  const parent = await found(deps.read, input.lang, input.id);
  const refused = holderRefusal(parent, input.userId);
  if (refused) throw new DesignError(refused, 403);

  const made = await deps.remix({ voiceId: parent.voiceId!, changes, text: previewText, ...input.settings }, input.apiKey);
  const parentArchetype = typeof parent.analysis?.archetype === "string" ? parent.analysis.archetype : null;
  const analysis: Record<string, unknown> = {
    ...describedBy(input.revisionHeard, input.archetype || parentArchetype),
    remix_of: parent.version,
    remix_changes: changes,
    remix_settings: input.settings,
  };
  const design = await deps.create({
    lang: input.lang,
    slot: parent.slot,
    prompt,
    previewText,
    previews: await keptPreviews(made, input.lang, deps),
    analysisId: parent.analysisId,
    analysis,
    userId: input.userId,
  });
  return { design, retired: await retireOlder({ ...input, kept: design }, deps) };
}

export async function found(read: (lang: Lang, id: string) => Promise<Design | null>, lang: Lang, id: string): Promise<Design> {
  const design = await read(lang, id);
  if (!design) throw new DesignError("no such design", 404);
  return design;
}

/**
 * The caller becomes the holder: the voice lives in their account. The holder may save another
 * preview in its place, under the same name and in the same account slot.
 */
export async function saveDesignVoice(
  input: { lang: Lang; id: string; preview: number; userId: string; apiKey: string },
  deps: DesignDeps = LIVE,
): Promise<Design> {
  return deps.lock(input.id, async () => {
    const design = await found(deps.read, input.lang, input.id);
    const preview = design.previews[input.preview];
    if (!Number.isInteger(input.preview) || !preview) throw new DesignError(`v${design.version} has no preview ${input.preview + 1}`, 400);
    const replacing = design.voiceId !== null && !design.voiceDeletedAt;
    if (replacing) {
      if (holderRefusal(design, input.userId) || design.chosenPreview === input.preview) {
        throw new DesignError(`v${design.version} is already saved, in ${design.holderName ?? "someone"}'s account`);
      }
      // The store refuses a shown version only after the old voice would already be gone.
      if (design.isPublic) throw new DesignError(SHOWN_REFUSAL);
      await freeAccountVoice(design, input.apiKey, deps);
    }

    const voiceName = designName(design);
    let voiceId: string | null = null;
    try {
      voiceId = await deps.createVoice({ name: voiceName, prompt: design.prompt, generatedVoiceId: preview.generatedVoiceId }, input.apiKey);
      await deps.save(input.lang, input.id, { chosenPreview: input.preview, voiceId, voiceName, holderId: input.userId });
    } catch (error) {
      await undoSave(input, voiceId, replacing, deps);
      throw error;
    }
    return (await deps.read(input.lang, input.id))!;
  });
}

/**
 * A voice no row names would hold an account slot unseen, and a row naming the deleted voice
 * would send samples and remixes to it. Cleanup failures are logged so the cause stays the error.
 */
async function undoSave(input: { lang: Lang; id: string; apiKey: string }, created: string | null, replaced: boolean, deps: DesignDeps) {
  if (created) {
    await deps.deleteVoice(created, input.apiKey).catch((error: unknown) => console.warn(`[voice-design] left voice ${created} in the account:`, error));
  }
  if (replaced) {
    await deps.markDeleted(input.lang, input.id).catch((error: unknown) => console.warn(`[voice-design] ${input.id} still names its deleted voice:`, error));
  }
}

/** Whether the caller may act on the version's account voice, or the refusal naming whose it is. */
export function holderRefusal(design: Design, userId: string): string | null {
  if (!design.voiceId || design.voiceDeletedAt) return `v${design.version} has no voice in an ElevenLabs account`;
  if (design.holderId !== userId) {
    return `v${design.version}'s voice is in ${design.holderName ?? "another member"}'s ElevenLabs account; only they can use it`;
  }
  return null;
}

/**
 * Frees an account slot. The audio stays. A voice since renamed to a slot on /voices is that
 * slot's live voice, and deleting it would silence the slot, so it is refused.
 */
export async function deleteDesignVoice(
  input: { lang: Lang; id: string; userId: string; apiKey: string },
  deps: DesignDeps = LIVE,
): Promise<Design> {
  return deps.lock(input.id, async () => {
    const design = await found(deps.read, input.lang, input.id);
    const refused = holderRefusal(design, input.userId);
    if (refused) throw new DesignError(refused, 403);

    await freeAccountVoice(design, input.apiKey, deps);
    await deps.markDeleted(input.lang, input.id);
    return (await deps.read(input.lang, input.id))!;
  });
}

async function freeAccountVoice(design: Design, apiKey: string, deps: DesignDeps): Promise<void> {
  const inAccount = (await deps.accountVoices(apiKey)).find((voice) => voice.voiceId === design.voiceId);
  if (inAccount && inAccount.name !== design.voiceName) {
    throw new DesignError(`the voice is now named "${inAccount.name}" in the account, so it may be in use; delete it on ElevenLabs if it is not`);
  }
  if (inAccount) await deps.deleteVoice(design.voiceId!, apiKey);
}

/**
 * Frees the caller's account of the older versions' voices; their rows and audio stay. Voices held
 * by someone else or adopted on /voices are kept, and no failure here fails the paid-for version.
 */
export async function retireOlder(
  input: { lang: Lang; kept: Design; userId: string; apiKey: string },
  deps: DesignDeps = LIVE,
): Promise<Design[]> {
  const retired: Design[] = [];
  const versions = await deps.slotDesigns(input.lang, input.kept.slot).catch((error: unknown) => {
    console.warn(`[voice-design] kept ${input.kept.slot}'s older voices:`, error);
    return [];
  });
  for (const design of versions) {
    if (design.version >= input.kept.version || holderRefusal(design, input.userId)) continue;
    try {
      retired.push(await deleteDesignVoice({ lang: input.lang, id: design.id, userId: input.userId, apiKey: input.apiKey }, deps));
    } catch (error) {
      console.warn(`[voice-design] kept ${design.slot} v${design.version}'s voice:`, error);
    }
  }
  return retired;
}
