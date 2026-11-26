import type { ReviewStatus } from "./groups";
import type { PreviewMetrics } from "./limits";

/**
 * A clip's measurements (scripts/voice_measure.py): openSMILE's eGeMAPS functionals, and the
 * s-level, room tail and speech level a preview is chosen by. Any part the helper could not
 * measure is absent; previews imported from round two carry only the last three.
 */
export type Measures = PreviewMetrics & {
  f0Hz?: number;
  f0RangeSt?: number;
  hnrDb?: number;
  jitter?: number;
  shimmerDb?: number;
  alphaRatioDb?: number;
  hammarbergDb?: number;
  h1h2Db?: number;
  loudness?: number;
  voicedPerSec?: number;
};

export type DesignPreview = { generatedVoiceId: string; sha256: string; measures: Measures | null };

export type DesignSample = {
  position: number;
  sha256: string;
  lineId: string;
  text: string;
  npcName: string | null;
  characters: number | null;
  credits: number | null;
};

export type ClipMark = "good" | "off";

export type Review = {
  id: number;
  status: ReviewStatus;
  note: string;
  bestPreview: number | null;
  /** `sample:<n>` or `preview:<n>`. */
  clips: Record<string, ClipMark>;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type Design = {
  id: string;
  lang: string;
  slot: string;
  version: number;
  prompt: string;
  previewText: string;
  previews: DesignPreview[];
  chosenPreview: number | null;
  voiceId: string | null;
  voiceName: string | null;
  holderId: string | null;
  holderName: string | null;
  voiceDeletedAt: string | null;
  sampleModel: string | null;
  analysisId: string | null;
  /** The designer's note on the version, such as which preview was saved and why. */
  note: string | null;
  /** Gemini's description of the voice: its archetype and, for a revision, what it heard. */
  analysis: Record<string, unknown> | null;
  samples: DesignSample[];
  /** Oldest first: the last is the version's verdict. */
  reviews: Review[];
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

/** What Gemini said about one recording. Free-form strings beyond the ones the page shows. */
export type GeminiVoice = {
  archetype?: string;
  voice_design_prompt: string;
  preview_text: string;
  [field: string]: string | undefined;
};

export type GeminiResult = {
  voices: Record<string, GeminiVoice>;
  rankings?: Record<string, string[]>;
  same_actor_guess?: string;
};

export type Analysis = {
  id: string;
  group: string;
  /** Letter Gemini heard to the slot it was. */
  labels: Record<string, string>;
  result: GeminiResult;
  measurements: Record<string, Measures> | null;
  model: string;
  createdByName: string | null;
  createdAt: string;
};
