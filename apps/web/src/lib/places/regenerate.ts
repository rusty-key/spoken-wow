/**
 * Narrating one zone line, on the shared queue's terms.
 *
 * What the zones site had here was a batch runner: a Map of batches on globalThis, its own
 * concurrency limiter, its own rate-limit backoff, its own stop flag. All of that is the
 * queue's now (lib/generation/queue.ts, worker.ts), which is what let its pm2 config stop
 * pinning a single worker. What is left is the part that is actually about zone lore:
 * which text, which voice, where the bytes go, and what the take records.
 *
 * The result is the quests side's RegenerateResult, not an exception, because the worker
 * decides what to do next from `kind` and `fatal`: running out of credits fails every
 * remaining line identically and stops the batch, while one line whose text cannot be
 * voiced is just one line.
 *
 * Resolving the narrator, the request and the commit are lib/generation/narrated.ts, shared
 * with readables. Places used to reach into pipelines/places/tools/voice/elevenlabs.mjs for the
 * request, which left the repository with two ElevenLabs clients and put one of them in a
 * pipeline that does no generating.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import "server-only";

import { failure } from "@/lib/generation/errors";
import { regenerateNarrated } from "@/lib/generation/narrated";
import type { RegenerateResult } from "@/lib/generation/regenerate";

import { catalogue, type CatalogueEntry } from "./catalogue";
import type { Speaker } from "@/lib/generation/speakers/speaker";

async function entryFor(lineId: string, lang: Lang): Promise<CatalogueEntry | undefined> {
  return (await catalogue(lang)).find((candidate) => candidate.id === lineId);
}

/**
 * One line, narrated and recorded.
 *
 * The signature is the queue's Generator: which line, whose provenance, whose credits.
 */
export async function regenerateZoneLine(
  lineId: string,
  createdBy: string,
  options: { speaker: Speaker; lang?: Lang; batchId?: string },
): Promise<RegenerateResult> {
  const entry = await entryFor(lineId, options.lang ?? BASE_LANG);
  if (!entry) {
    return { ok: false, failure: { ...failure("bad-request", `no line ${lineId}`), status: 404 } };
  }

  // A line with no text at all is not a failure of this request, so it is a
  // bad-request rather than an upstream one.
  if (!entry.spoken.trim()) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} has no text to narrate`),
        status: 409,
        fatal: false,
      },
    };
  }

  return regenerateNarrated(
    "places",
    { lineId: entry.id, file: entry.file, spoken: entry.spoken, shown: entry.full, hash: entry.hash },
    createdBy,
    options,
  );
}
