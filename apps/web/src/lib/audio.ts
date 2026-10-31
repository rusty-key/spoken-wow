/**
 * A quests line's audio path as the addon resolves it: {quests,gossip,followup}/<fileName>.mp3.
 *
 * `fileName` comes from the corpus, computed by Python. The only naming decision made on
 * this side is which subdirectory a line lives in, and it lives here alone - it is the
 * TypeScript twin of subfolder_from_line_id in tts_cli/naming.py.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import { memoByLang } from "@/lib/memo";
import type { CorpusLine } from "./corpus";
import { corpus } from "./quests/catalogue";

export const SUBFOLDERS = ["quests", "gossip", "followup"] as const;

/**
 * By the line id's kind, not its source: NPC chat is named like a follow-up line, after its words
 * and voice, and shares its folder. The addon resolves the path itself, so it must match Python's.
 */
const KIND_FOLDER: Record<string, (typeof SUBFOLDERS)[number]> = { q: "quests", g: "gossip", f: "followup" };

export function subfolder(line: Pick<CorpusLine, "lineId">): (typeof SUBFOLDERS)[number] {
  const kind = line.lineId.split(":", 1)[0];
  const folder = KIND_FOLDER[kind];
  if (!folder) throw new Error(`unknown lineId kind ${JSON.stringify(kind)} in ${JSON.stringify(line.lineId)}`);
  return folder;
}

/** The addon's path, e.g. "quests/5-accept.mp3". Also the take's `file` and the /api/quests/audio/ route path. */
export function audioRelPath(line: Pick<CorpusLine, "lineId" | "fileName">): string {
  return `${subfolder(line)}/${line.fileName}.mp3`;
}

/**
 * A line for each audio path, the reverse of audioRelPath.
 *
 * One line, not the group: everything that shares a file shares its text and its voice, which
 * is the whole reason they share the file. So the first is as good as any for "what would be
 * spoken for this mp3", which is what staleness needs to know.
 *
 * Also the whitelist of paths the corpus can address, and the reason the history playback
 * route is traversal-proof by construction: a path either names a file some corpus line owns
 * or it does not exist, and no amount of `../` produces a key of this map. Membership does
 * not depend on what is on disk -- an archived take can be served for a line whose current
 * audio is missing.
 *
 * Memoised on the corpus's identity: 17,507 entries built once rather than per request, and
 * rebuilt exactly when the catalogue is.
 */
const fileIndexKey = Symbol.for("wow-voiceover.file-index.by-lang");

/** Per language, since a file is the same in every one but the line's text is not. */
export async function fileIndex(lang: Lang = BASE_LANG): Promise<Map<string, CorpusLine>> {
  const lines = (await corpus(lang)).lines;
  return memoByLang(fileIndexKey, lang, lines, () => {
    const index = new Map<string, CorpusLine>();
    for (const line of lines) {
      const file = audioRelPath(line);
      if (!index.has(file)) index.set(file, line);
    }
    return index;
  });
}
