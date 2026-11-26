/**
 * One spending action per version at a time. Save, Sample and Delete each read the version,
 * call ElevenLabs, then write: two of them overlapping would both pay, or leave a voice in an
 * account that no row records.
 */
import "server-only";

import { BUSY, withFileLock } from "@/lib/generation/lock";

import { DesignError } from "./access";

export async function withDesignLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const result = await withFileLock(`voice_design:${id}`, work);
  if (result === BUSY) throw new DesignError("someone is already working on this version; try again when it finishes", 409);
  return result;
}
