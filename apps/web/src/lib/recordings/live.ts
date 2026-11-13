/**
 * What the explorers know about a file's voice-actor recording, and the filter on it.
 *
 * Browser-safe: the rows and the search bars of all three sections read it. Only somebody
 * who records in the language gets either -- the search routes leave `recording` off every
 * row and drop the filter for anybody else (recordings/store.ts recordingsFor), the way the
 * made-by columns are left off for visitors.
 */
import type { RecordingFormat } from "./match";

export type LiveRecording = {
  version: number;
  format: RecordingFormat;
  durationSec: number;
  credit: string;
  createdBy: string | null;
  createdAt: string;
};

export const RECORDED = ["yes", "no"] as const;
export type Recorded = (typeof RECORDED)[number];

export const RECORDED_OPTIONS = [
  { value: "yes", label: "recorded" },
  { value: "no", label: "not recorded" },
] as const satisfies readonly { value: Recorded; label: string }[];

/**
 * Whether a file passes the filter. Without the recordings in hand nothing is known
 * recorded, so "yes" matches nothing and "no" everything -- but the routes drop the filter
 * before it gets that far for anybody who may not see them.
 */
export function recordedMatches(recording: LiveRecording | null | undefined, want: Recorded | undefined): boolean {
  if (!want) return true;
  return want === "yes" ? Boolean(recording) : !recording;
}
