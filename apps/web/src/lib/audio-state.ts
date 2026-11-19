/**
 * Where a line's audio stands, as all three explorers filter on it: quests, places and readables.
 *
 * One vocabulary and one set of labels, so the audio filter reads the same on every page.
 * Client-safe, like lib/line-fields.ts: the filter bars import it.
 *
 * missing = voiceable and no audio; stale = the audio was made from text that has since
 * changed; current = audio, and its text has not moved. A pronunciation change is not a
 * fourth state -- current audio can carry one -- which is why "pronunciation moved" is a
 * checkbox of its own on every page.
 */
export const AUDIO_STATES = ["missing", "stale", "current"] as const;

export type AudioState = (typeof AUDIO_STATES)[number];

// The filter pill reads "Audio outdated". The URL keeps the value (?state=stale), which is what
// places and readables links already carry.
export const AUDIO_STATE_LABELS: Record<AudioState, string> = {
  missing: "missing",
  stale: "outdated",
  current: "up to date",
};

/**
 * What the audio buttons show: every filter applied except the audio state, so pressing Missing
 * does not zero the Outdated count beside it. `all` is not the sum of the three, because a line
 * that cannot be voiced and has no audio is in none of them.
 */
export type StateCounts = Record<AudioState, number> & { all: number };

/** StateCounts over lines that each know their state, as the places and readables lines do. */
export function stateCounts(lines: readonly { state: AudioState }[]): StateCounts {
  const counts: StateCounts = { all: lines.length, missing: 0, stale: 0, current: 0 };
  for (const line of lines) counts[line.state]++;
  return counts;
}

/**
 * The audio state off a query string, as `state` -- the key places and readables use -- or from
 * the two checkboxes quests had before the three explorers were aligned (?missing=1 and
 * ?outdated=1), so a link made then still opens the view it was made of.
 */
export function audioStateFromParams(params: URLSearchParams): AudioState | undefined {
  const state = params.get("state");
  if ((AUDIO_STATES as readonly string[]).includes(state ?? "")) return state as AudioState;
  if (params.get("missing") === "1") return "missing";
  if (params.get("outdated") === "1") return "stale";
  return undefined;
}
