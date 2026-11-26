/**
 * Where a design's previews and samples are kept: the archive, by the bytes' hash, beside the
 * takes. They are never deleted, since ElevenLabs keeps no preview once a voice is saved.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { keep } from "@/lib/blobs/keep";
import { blobKey, blobOrFile, readsBlobs, sha256Of, type Stored } from "@/lib/blobs/store";
import { blobBytes } from "@/lib/blobs/where";
import type { Lang } from "@/lib/lang";
import { VOICE_DESIGNS_DIR } from "@/lib/paths";

const diskPath = (sha256: string) => path.join(VOICE_DESIGNS_DIR, `${sha256}.mp3`);

/** The hash, which names the audio in every mode: `keep` returns none while the volume is the record. */
export async function keepDesignAudio(data: Buffer, lang: Lang): Promise<string> {
  const sha256 = sha256Of(data);
  await keep("designs", data, "audio/mpeg", diskPath(sha256), lang);
  return sha256;
}

export function designClip(sha256: string, lang: Lang): Stored {
  return blobOrFile("designs", sha256, diskPath(sha256), lang);
}

export async function readDesignAudio(sha256: string, lang: Lang): Promise<Buffer | null> {
  if (readsBlobs()) return blobBytes(blobKey("designs", sha256), lang);
  return fs.readFile(diskPath(sha256)).catch(() => null);
}
