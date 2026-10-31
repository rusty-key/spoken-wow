// Narrating one boss story, on the shared queue's terms: lib/places/regenerate.ts over the boss
// catalogue. Finding the narrator, the request and the commit are lib/generation/narrated.ts.
//
// The story voiced is the language's own. A boss with no story in the language has nothing to
// voice, which is one line's failure and not the batch's, so it is non-fatal.

import "server-only";

import { BASE_LANG, type Lang } from "@/lib/lang";
import { failure } from "@/lib/generation/errors";
import { regenerateNarrated } from "@/lib/generation/narrated";
import type { RegenerateResult } from "@/lib/generation/regenerate";
import type { Speaker } from "@/lib/generation/speakers/speaker";

import { catalogue } from "./catalogue";

/** One boss story, narrated and recorded. The signature is the queue's Generator. */
export async function regenerateBossLine(
  lineId: string,
  createdBy: string,
  options: { speaker: Speaker; lang?: Lang; batchId?: string },
): Promise<RegenerateResult> {
  const entry = (await catalogue(options.lang ?? BASE_LANG)).find((candidate) => candidate.id === lineId);
  if (!entry) {
    return { ok: false, failure: { ...failure("bad-request", `no boss ${lineId}`), status: 404 } };
  }

  if (entry.text === null || entry.spoken === null || entry.hash === null || !entry.spoken.trim()) {
    return {
      ok: false,
      failure: { ...failure("bad-request", "no story in this language"), status: 409, fatal: false },
    };
  }

  return regenerateNarrated(
    "bosses",
    { lineId: entry.id, file: entry.file, spoken: entry.spoken, shown: entry.text, hash: entry.hash },
    createdBy,
    options,
  );
}
