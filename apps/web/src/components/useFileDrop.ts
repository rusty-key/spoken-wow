"use client";

import { useState, type DragEvent } from "react";

/**
 * An element that takes files dropped on it: whether something is being dragged over it, and
 * the handlers to spread on it. Only a drag carrying files counts, so dragging text or a link
 * across the page lights nothing up.
 *
 * A dropped folder is opened and its files taken, however deep: an actor's session is a
 * folder, and the browser's own file list holds one entry for it with nothing inside.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver(event: DragEvent) {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave() {
        setOver(false);
      },
      onDrop(event: DragEvent) {
        event.preventDefault();
        setOver(false);
        // Taken now: the transfer is emptied once the handler returns.
        const entries = [...event.dataTransfer.items]
          .map((item) => item.webkitGetAsEntry?.())
          .filter((entry): entry is FileSystemEntry => Boolean(entry));
        const files = [...event.dataTransfer.files];
        if (entries.length === 0) onFiles(files);
        else void filesIn(entries).then(onFiles);
      },
    },
  };
}

/** Every file under some dropped entries, leaving out hidden ones such as .DS_Store. */
async function filesIn(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.name.startsWith(".")) return;
    if (entry.isFile) {
      files.push(await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries answers in batches, and an empty one is the end.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return files;
}
