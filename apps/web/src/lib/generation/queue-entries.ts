/**
 * Shared by the batch route and the Manager's single-line queueing, so a line is refused and
 * labelled the same way whichever queued it.
 */
import type { CatalogueEntry } from "@/lib/places/catalogue";
import type { BookPage } from "@/lib/readables/catalogue";
import type { BatchLine } from "@/lib/search";

import type { QueueEntry } from "./queue";

export function questsEntry(job: BatchLine): QueueEntry {
  return { lineId: job.lineId, file: job.audioPath, npcName: job.npcName, preview: job.preview, characters: job.characters };
}

/** Null for an untranslated line, so the quote does not pay per line to find that out. */
export function placesEntry(entry: CatalogueEntry): QueueEntry | null {
  if (entry.spoken.trim() === "") return null;
  return {
    lineId: entry.id,
    file: entry.file,
    // No NPC here: the column only labels the progress readout, and the zone names the line.
    npcName: entry.zoneName,
    preview: entry.short || entry.full.slice(0, 120),
    characters: entry.spoken.length,
  };
}

/** Null for a page nothing can voice: the corpus holds every page the game has. */
export function readablesEntry(page: BookPage): QueueEntry | null {
  if (!page.generatable || page.spoken.trim() === "") return null;
  return {
    lineId: page.id,
    file: page.file,
    npcName: page.pageCount > 1 ? `${page.title} (${page.pageNumber}/${page.pageCount})` : page.title,
    preview: page.spoken.slice(0, 120),
    characters: page.spoken.length,
  };
}
