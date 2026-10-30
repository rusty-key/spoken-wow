/**
 * A catalogue line as a queue job, per section.
 *
 * Shared by the batch route and the Manager's single-line queueing, so that a line is
 * refused, and labelled in the progress readout, the same way whichever queued it.
 */
import type { CatalogueEntry } from "@/lib/places/catalogue";
import type { BookPage } from "@/lib/readables/catalogue";
import type { BatchLine } from "@/lib/search";

import type { QueueEntry } from "./queue";

/** BatchLine calls it audioPath and the queue calls it file: a job is one mp3 either way. */
export function questsEntry(job: BatchLine): QueueEntry {
  return { lineId: job.lineId, file: job.audioPath, npcName: job.npcName, preview: job.preview, characters: job.characters };
}

/**
 * Null for a line with no text: an untranslated line has nothing to narrate, and paying to
 * find that out once per line is what the quote exists to prevent.
 */
export function placesEntry(entry: CatalogueEntry): QueueEntry | null {
  if (entry.spoken.trim() === "") return null;
  return {
    lineId: entry.id,
    file: entry.file,
    // There is no NPC here. The column is a label for the progress readout, and the zone is
    // what names a line on screen.
    npcName: entry.zoneName,
    preview: entry.short || entry.full.slice(0, 120),
    characters: entry.spoken.length,
  };
}

/**
 * Null for a page nothing can voice: it is in the corpus because the game has it, not
 * because anyone can narrate it.
 */
export function readablesEntry(page: BookPage): QueueEntry | null {
  if (!page.generatable || page.spoken.trim() === "") return null;
  return {
    lineId: page.id,
    file: page.file,
    // A book's title plus its page number is what names a page on screen.
    npcName: page.pageCount > 1 ? `${page.title} (${page.pageNumber}/${page.pageCount})` : page.title,
    preview: page.spoken.slice(0, 120),
    characters: page.spoken.length,
  };
}
