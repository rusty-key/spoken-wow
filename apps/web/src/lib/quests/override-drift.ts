import { spokenHash } from "@/lib/generation/spoken-hash";

/** A row saved before the hash existed has nothing to compare, so it stays quiet. */
export function hasDrifted(override: { originalHash?: string | null } | undefined, originalText: string): boolean {
  return Boolean(override?.originalHash) && override?.originalHash !== spokenHash(originalText);
}
