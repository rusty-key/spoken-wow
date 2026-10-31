// Which boss audio paths exist, and so which may be asked for.

import "server-only";

import { BASE_LANG } from "@/lib/lang";

import { catalogue } from "./catalogue";

/** Store-relative, e.g. '36/edwin-vancleef.mp3'. Also the /api/bosses/audio/ route path. */
export function audioRelPath(file: string): string {
  return `${file}.mp3`;
}

/**
 * Every path a boss owns. Set membership is the traversal guard: no amount of "../" produces
 * a member. A boss's file is the same in every language and every live boss is in every
 * language's catalogue, so English's answers for all of them.
 */
export async function addressableFiles(): Promise<Set<string>> {
  return new Set((await catalogue(BASE_LANG)).map((entry) => audioRelPath(entry.file)));
}

export async function isAddressable(relPath: string): Promise<boolean> {
  return (await addressableFiles()).has(relPath);
}
