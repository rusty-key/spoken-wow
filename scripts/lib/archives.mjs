// Where each section's take archive is on this machine: the deployment's
// SPOKEN_<SECTION>_AUDIO_HISTORY, or the pipeline's audio-history/ beside it.
//
// One rule for every script that reads the archive -- sounds.mjs for the takes, acted.mjs for
// the voice actors' recordings -- and the one pull-live.sh writes into by the same variable,
// so a pull lands where a build looks.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function archiveOf(section) {
  return process.env[`SPOKEN_${section.toUpperCase()}_AUDIO_HISTORY`] ?? join(ROOT, "pipelines", section, "audio-history");
}

// A row's path under the section's archive root, as `--list` prints it and pull-live.sh fetches
// it. "" means nobody kept the clip. A row with a hash and no volume path is only in the
// bucket, so without the bucket's address it cannot be found, not "never kept".
export function sourceOf(prefix, sha256, archivedPath) {
  if (sha256 && process.env.SPOKEN_ARCHIVE_URL) return `blobs/${prefix}/${sha256}`;
  if (sha256 && !archivedPath) {
    throw new Error(`${prefix}/${sha256} is only in the archive bucket: set SPOKEN_ARCHIVE_URL to its public address`);
  }
  return archivedPath;
}
