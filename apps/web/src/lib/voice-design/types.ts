import type { ReviewStatus } from "./groups";
import type { PreviewMetrics } from "./limits";

/**
 * A clip's measurements (scripts/voice_measure.py): openSMILE's eGeMAPS functionals, and the
 * s-level, room tail and speech level a preview is chosen by. Any part the helper could not
 * measure is absent; imported previews may carry only the last three.
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
  f1Hz?: number;
  f2Hz?: number;
  f3Hz?: number;
  loudness?: number;
  voicedPerSec?: number;
  durationSec?: number;
  pauseRate?: number;
  pauseMeanSec?: number;
  f0SdSt?: number;
  phraseEndSt?: number;
  loudnessSdDb?: number;
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

/** A player's answer to "Does this fit the character?" on /listen. */
export type Verdict = "fits" | "close" | "off" | "skip";

export const VERDICTS: readonly Verdict[] = ["fits", "close", "off", "skip"];

export type FeedbackNote = {
  /** `u:<userId>` or `a:<uuid>`: what Hide names the note by. */
  voter: string;
  /** The account's name; null for an anonymous voter. */
  who: string | null;
  verdict: Verdict;
  note: string;
  at: string;
};

/** One press of Show to players and the votes players gave in it. */
export type Showing = {
  id: number;
  createdAt: string;
  createdByName: string | null;
  counts: Record<Verdict, number>;
  /** Newest first; hidden notes are left out, their verdicts still counted. */
  notes: FeedbackNote[];
  /** The lines players heard and voted on; null for a round from before they were kept. */
  samples: ShownLine[] | null;
  /** The version has been voiced again since: its votes are about `samples`, not its lines now. */
  linesChanged: boolean;
};

export type ShownLine = { sha256: string; text: string | null; npcName: string | null };

/** A player's note a reviewer picked to act on, as it read when picked. */
export type PlayerNote = { verdict: Verdict; note: string };

/** Who compared the takes in What's different: Gemini listens, Claude reads a picture and numbers. */
export type Judge = "gemini" | "claude";

export const JUDGES: readonly Judge[] = ["gemini", "claude"];

export const JUDGE_NAME: Record<Judge, string> = { gemini: "Gemini", claude: "Claude" };

export const JUDGE_KEY: Record<Judge, "gemini" | "anthropic"> = { gemini: "gemini", claude: "anthropic" };

/**
 * A What's different finding added to a verdict: how the version's take sounds next to the live
 * take. A description of the version, never a wish: "slower" here means the reviewer may want faster.
 */
export type Observation = {
  by: Judge;
  note: string;
  /** Claude's suggested prompt changes, if it was Claude. */
  fixes?: string[];
};

export type Review = {
  id: number;
  status: ReviewStatus;
  note: string;
  bestPreview: number | null;
  /** `sample:<n>` or `preview:<n>`. */
  clips: Record<string, ClipMark>;
  players: PlayerNote[];
  observations: Observation[];
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
  /** When the sample lines were voiced: a verdict older than this marked other lines. */
  sampledAt: string | null;
  /** Oldest first: the last is the version's verdict. */
  reviews: Review[];
  /** Whether players hear this version on /listen now: its slot's newest showing is of it. */
  isPublic: boolean;
  /** Shown, then voiced again: players still hear the lines it had when shown, until it is shown again. */
  playersHearOlderLines: boolean;
  /** Newest first. */
  showings: Showing[];
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
