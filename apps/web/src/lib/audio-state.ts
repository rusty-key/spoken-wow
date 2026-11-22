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

/**
 * What the audio buttons show: every filter applied except the audio state, so pressing Missing
 * does not zero the Outdated count beside it. `all` is not the sum of the three, because a line
 * that cannot be voiced and has no audio is in none of them.
 */
export type StateCounts = Record<AudioState, number> & { all: number };

/**
 * Lines matched under every filter but the state, split into the buttons' counts and the lines
 * the pressed state shows. For lines that each know their state, as places, bosses and readables do.
 */
export function byState<T extends { state: AudioState }>(
  unstated: T[],
  state: AudioState | undefined,
): { counts: StateCounts; matched: T[] } {
  const counts: StateCounts = { all: unstated.length, missing: 0, stale: 0, current: 0 };
  for (const line of unstated) counts[line.state]++;
  return { counts, matched: state ? unstated.filter((line) => line.state === state) : unstated };
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
