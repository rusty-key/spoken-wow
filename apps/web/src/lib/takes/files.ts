/**
 * Whether a section can address a file at all.
 *
 * The guard on every take route, and a whitelist rather than a shape check: a path either
 * names a file some line owns or it does not exist, and no amount of "../" produces a
 * member of that set. Each section already builds this set for its own audio route; this
 * is the same question asked in one place, so a new route cannot accidentally ask it a
 * weaker way.
 */
import "server-only";

import { fileIndex } from "@/lib/audio";
import { addressableFiles as booksFiles } from "@/lib/books/audio";

import { addressableFiles as zonesFiles } from "@/lib/zones/audio";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

/**
 * Zones and books name a file without its extension; their addressable sets carry one. A
 * quests file is English's, or one only the language has. English first: nearly every file is
 * one, and its catalogue is the cheaper of the two to keep current.
 */
export async function isAddressableFile(source: Source, file: string, lang: Lang = BASE_LANG): Promise<boolean> {
  if (source === "quests") {
    return (await fileIndex()).has(file) || (lang !== BASE_LANG && (await fileIndex(lang)).has(file));
  }
  const files = source === "zones" ? await zonesFiles() : await booksFiles();
  return files.has(`${file}.mp3`);
}
