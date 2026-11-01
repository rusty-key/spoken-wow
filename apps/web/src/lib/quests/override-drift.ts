/** Whether an override was saved over an original text that has changed since. */
import { spokenHash } from "@/lib/generation/spoken-hash";

import type { LineOverride } from "./override";

/** A row saved before the hash existed has nothing to compare, so it stays quiet. */
export function hasDrifted(override: LineOverride | undefined, originalText: string): boolean {
  return Boolean(override?.originalHash) && override?.originalHash !== spokenHash(originalText);
}
