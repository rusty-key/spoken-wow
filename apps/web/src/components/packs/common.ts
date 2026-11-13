import type { Pack, Submission } from "@/lib/community/store";

/** A user id to show: the name if it has one, and the id is null once the account is deleted. */
export function nameOf(id: string | null, name: string | null | undefined): string {
  return id ? (name ?? "an unnamed account") : "a deleted account";
}

/** The most recent of what the store returns, which is where a new version's fields start. */
export function newest(pack: Pack): Submission | null {
  const all = [pack.live, pack.pending, pack.lastRejected].filter((s): s is Submission => s !== null);
  return all.reduce<Submission | null>((best, s) => (!best || BigInt(s.id) > BigInt(best.id) ? s : best), null);
}

export const TEXTAREA =
  "border-input w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none md:text-sm " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";
