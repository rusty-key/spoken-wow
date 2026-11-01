/** Which overrides were saved over an original text that has changed since. */
import { fileIndex } from "@/lib/audio";
import { spokenHash } from "@/lib/generation/spoken-hash";

import type { LineOverride } from "./override";
import { readOverrides } from "./overrides";

/** A row saved before the hash existed has nothing to compare, so it stays quiet. */
export function hasDrifted(override: LineOverride | undefined, originalText: string): boolean {
  return Boolean(override?.originalHash) && override?.originalHash !== spokenHash(originalText);
}

/** By file. A file gone from the corpus has no original to have changed. */
export async function driftedOverrides(): Promise<Set<string>> {
  const [overrides, index] = await Promise.all([readOverrides(), fileIndex()]);
  const drifted = new Set<string>();
  for (const [file, override] of overrides) {
    const original = index.get(file);
    if (original && hasDrifted(override, original.text)) drifted.add(file);
  }
  return drifted;
}
