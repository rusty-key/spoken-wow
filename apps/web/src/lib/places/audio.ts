// Which places audio paths, and which are allowed to be asked for.

import "server-only";

import { catalogue } from "./catalogue";

/** Store-relative, e.g. '1411/razor-hill.mp3'. Also the /api/places/audio/ route path. */
export function audioRelPath(file: string): string {
  return `${file}.mp3`;
}

// Every path the catalogue can address. The guard against traversal is set membership
// rather than string inspection: a path either names a file some line owns or it does
// not exist, and no amount of "../" produces a member of this set.
//
// Derived from naming.mjs's own file assignment, so a request can only reach a clip the
// addon could also reach. lib/audio.ts makes the same argument for the quests store.
//
// Not memoised separately. It is one pass over the catalogue, which is memoised and
// stamped against the table -- and a second memo here would be a second thing to keep in
// step with a corpus that changes, for a Set built in a millisecond from a list already in
// memory. The zones site kept one, and it was one more cache its by-hand invalidation had
// to remember.
export async function addressableFiles(): Promise<Set<string>> {
  return new Set((await catalogue()).map((entry) => audioRelPath(entry.file)));
}

export async function isAddressable(relPath: string, ): Promise<boolean> {
  return (await addressableFiles()).has(relPath);
}

