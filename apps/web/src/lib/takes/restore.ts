/**
 * Putting an earlier take back, in one place for all three sections.
 *
 * ONE STEP: move the live flag onto that take. No file is read, copied or written. Every
 * take is its own file in the archive, written once when it was cut, and the live one is
 * whichever row says so -- the site plays it from there, and a pack build copies it into
 * Sounds/ (scripts/audio/sounds.mjs). So a restore is a statement about which take is
 * right, the same thing it means for a lore version (lib/places/lore.ts), and it cannot lose
 * audio because it touches none.
 *
 * NO NEW ROW, for the same reason: the history is what this line has been, and nothing
 * about putting an old take back is a new take.
 *
 * A take whose clip was not kept cannot be made live: the line would then have a live take
 * with nothing to play, and the pack would ship a gap where it had audio. Whether a kept
 * clip is really on this machine's disk is not asked -- the player reports a missing file
 * when somebody presses play.
 *
 * The one thing a restore may add is the take's pack encoding: a release refuses a live take
 * without one.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

import { encodeArchivedForPack } from "./encode";
import { setLiveTake, takePath, takeSha256 } from "./store";

export async function restoreTake(
  source: Source,
  file: string,
  version: number,
  lang: Lang,
  by: string | null,
): Promise<void> {
  const bytes = await takePath(source, file, version, lang);
  if (bytes.kind === "none") throw new Error(`no version ${version} of ${file} in ${source}`);
  if (bytes.kind === "gone") {
    throw new Error(`the audio of version ${version} of ${file} was not kept, so it cannot be restored`);
  }
  await setLiveTake(source, file, version, lang, by);
  // By its hash rather than by where it is read from: in dual mode a take is read from disk, but
  // its master is in the bucket too, which is all an encoding needs.
  const sha256 = await takeSha256(source, file, version, lang);
  if (sha256) await encodeArchivedForPack(source, sha256, { lang, file, version });
}
