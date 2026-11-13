/**
 * Where a line's audio stands, as all three explorers filter on it: quests, places and readables.
 *
 * One vocabulary and one set of labels, so the "audio" chip reads the same on every page.
 * Client-safe, like lib/line-fields.ts: the filter bars import it.
 *
 * missing = voiceable and no audio; stale = the audio was made from text that has since
 * changed; current = audio, and its text has not moved. A pronunciation change is not a
 * fourth state -- current audio can carry one -- which is why "pronunciation moved" is a
 * checkbox of its own on every page.
 */
export const AUDIO_STATES = ["missing", "stale", "current"] as const;

export type AudioState = (typeof AUDIO_STATES)[number];

// The chip reads "audio: outdated". The URL keeps the value (?state=stale), which is what
// places and readables links already carry.
export const AUDIO_STATE_LABELS: Record<AudioState, string> = {
  missing: "missing",
  stale: "outdated",
  current: "up to date",
};

export const AUDIO_STATE_OPTIONS = AUDIO_STATES.map((state) => ({
  value: state,
  label: AUDIO_STATE_LABELS[state],
}));

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
