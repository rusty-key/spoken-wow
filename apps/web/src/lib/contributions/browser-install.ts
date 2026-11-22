/**
 * The install id a browser sends with a Contribute link, made once and kept in localStorage.
 *
 * A link the addon hands out is a line the player's pack could not voice. When the corpus already
 * has the text there is nothing to triage, but the pack's language team still needs to know that
 * a player heard it in silence: missing-audio.ts counts that once per line, pack language and
 * install, and the Spoken Manager's install id is not here to count by. This is the browser's own,
 * random and tied to nothing else, so one player clicking the same link twice is one hit.
 *
 * Null where storage is refused (private modes, blocked site data): the line is then dropped as it
 * always was, rather than counted under an id that changes on every page load.
 */
const KEY = "spoken.installId";

export function browserInstallId(): string | null {
  try {
    const kept = window.localStorage.getItem(KEY);
    if (kept) return kept;
    const made = crypto.randomUUID();
    window.localStorage.setItem(KEY, made);
    return made;
  } catch {
    return null;
  }
}
