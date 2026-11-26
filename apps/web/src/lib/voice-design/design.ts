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
  type AccountVoice,
  type DesignedPreview,
} from "@/lib/voices/elevenlabs";
import { isVoiceSlot } from "@/lib/voices/slots";

import { DesignError } from "./access";
import { keepDesignAudio } from "./audio";
import { DESIGN_LIMITS, designName, promptLengthProblem, withEnding } from "./limits";
import { withDesignLock } from "./lock";
import { measureAudio } from "./measure";
import { createDesign, isOwnAnalysis, markVoiceDeleted, readDesign, saveVoice, type NewDesign } from "./store";
import type { Design, Measures } from "./types";

export type DesignDeps = {
  isSlot: (slot: string, lang: Lang) => Promise<boolean>;
  isOwnAnalysis: (lang: Lang, id: string) => Promise<boolean>;
  design: (input: { prompt: string; text: string }, apiKey: string) => Promise<DesignedPreview[]>;
  keepAudio: (data: Buffer, lang: Lang) => Promise<string>;
  measure: (clips: Buffer[]) => Promise<(Measures | null)[] | null>;
  create: (input: NewDesign) => Promise<Design>;
  read: (lang: Lang, id: string) => Promise<Design | null>;
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
  keepAudio: keepDesignAudio,
  measure: (clips) => measureAudio(clips),
  create: createDesign,
  read: readDesign,
  save: saveVoice,
  createVoice: (input, apiKey) => createDesignedVoice(input, { apiKey }),
  accountVoices: (apiKey) => listAccountVoices({ apiKey }),
  deleteVoice: (voiceId, apiKey) => deleteVoice(voiceId, { apiKey }),
  markDeleted: markVoiceDeleted,
  lock: withDesignLock,
};

export function rejectDesign(prompt: string, previewText: string): string | null {
  const { textMin, textMax } = DESIGN_LIMITS;
  const promptProblem = promptLengthProblem(prompt);
  if (promptProblem) return promptProblem;
  if (previewText.length < textMin || previewText.length > textMax) return `the preview text must be ${textMin} to ${textMax} characters`;
  return null;
}

export async function designVersion(
  input: {
    lang: Lang;
    slot: string;
    prompt: string;
    previewText: string;
    analysisId: string | null;
    /** What Gemini heard when it drafted this version from a review. */
    revisionHeard?: string | null;
    userId: string;
    apiKey: string;
  },
  deps: DesignDeps = LIVE,
): Promise<Design> {
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
  const [shas, measured] = await Promise.all([
    Promise.all(made.map((preview) => deps.keepAudio(preview.audio, input.lang))),
    deps.measure(made.map((preview) => preview.audio)),
  ]);
  return deps.create({
    lang: input.lang,
    slot: input.slot,
    prompt,
    previewText,
    previews: made.map((preview, i) => ({ generatedVoiceId: preview.generatedVoiceId, sha256: shas[i], measures: measured?.[i] ?? null })),
    analysisId: input.analysisId,
    analysis: input.revisionHeard ? { revision_heard: input.revisionHeard } : null,
    userId: input.userId,
  });
}

export async function found(read: (lang: Lang, id: string) => Promise<Design | null>, lang: Lang, id: string): Promise<Design> {
  const design = await read(lang, id);
  if (!design) throw new DesignError("no such design", 404);
  return design;
}

/** The caller becomes the holder: the voice lives in their account. */
export async function saveDesignVoice(
  input: { lang: Lang; id: string; preview: number; userId: string; apiKey: string },
  deps: DesignDeps = LIVE,
): Promise<Design> {
  return deps.lock(input.id, async () => {
    const design = await found(deps.read, input.lang, input.id);
    if (design.voiceId) throw new DesignError(`v${design.version} is already saved, in ${design.holderName ?? "someone"}'s account`);
    const preview = design.previews[input.preview];
    if (!Number.isInteger(input.preview) || !preview) throw new DesignError(`v${design.version} has no preview ${input.preview + 1}`, 400);

    const voiceName = designName(design);
    const voiceId = await deps.createVoice({ name: voiceName, prompt: design.prompt, generatedVoiceId: preview.generatedVoiceId }, input.apiKey);
    await deps.save(input.lang, input.id, { chosenPreview: input.preview, voiceId, voiceName, holderId: input.userId });
    return (await deps.read(input.lang, input.id))!;
  });
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

    const inAccount = (await deps.accountVoices(input.apiKey)).find((voice) => voice.voiceId === design.voiceId);
    if (inAccount && inAccount.name !== design.voiceName) {
      throw new DesignError(`the voice is now named "${inAccount.name}" in the account, so it may be in use; delete it on ElevenLabs if it is not`);
    }
    if (inAccount) await deps.deleteVoice(design.voiceId!, input.apiKey);
    await deps.markDeleted(input.lang, input.id);
    return (await deps.read(input.lang, input.id))!;
  });
}
