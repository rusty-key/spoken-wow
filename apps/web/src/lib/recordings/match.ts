/**
 * Which line an uploaded file is a recording of, by its name.
 *
 * An actor records a session's worth of lines and drops the folder on the page, so the name
 * is all there is to go on. Each section's name for a file is its addon path flattened to
 * one segment, which is also what a recording is called when somebody downloads it:
 *
 *   quests  quests/33-accept.mp3       33-accept.ogg    (m-/f- prefixes are their own files)
 *           gossip/31ab….mp3           31ab….mp3
 *   places  1411/razor-hill            1411-razor-hill.mp3
 *           947/zone                   947-zone.mp3     (every map has a `zone`, so the map
 *                                                        id has to be in the name)
 *   readables 1381                     1381.mp3
 *   bosses  36/edwin-vancleef          36-edwin-vancleef.mp3
 *
 * Browser-safe: the drop zone names files with it before anything is sent.
 */
import type { Source } from "@/lib/sections";

export const RECORDING_FORMATS = ["mp3", "ogg"] as const;
export type RecordingFormat = (typeof RECORDING_FORMATS)[number];

/** What a file picker offers. */
export const RECORDING_ACCEPT = ".mp3,.ogg,audio/mpeg,audio/ogg";

/** Per file. A ten-minute line at 320 kbps is 23 MiB; anything larger is not one line. */
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

export function isRecordingFormat(value: unknown): value is RecordingFormat {
  return typeof value === "string" && (RECORDING_FORMATS as readonly string[]).includes(value);
}

/** What an upload of `file` should be called, less its extension. */
export function recordingStem(source: Source, file: string): string {
  if (source === "quests") return file.slice(file.lastIndexOf("/") + 1).replace(/\.mp3$/, "");
  return file.replaceAll("/", "-");
}

/** An uploaded name's format and stem: `Folder/1411-Razor-Hill.MP3` is mp3, `1411-razor-hill`. */
export function parseUploadName(name: string): { stem: string; format: RecordingFormat | null } {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase();
  return { stem, format: isRecordingFormat(ext) ? ext : null };
}

export type Match =
  | { name: string; file: string; format: RecordingFormat }
  | { name: string; file: null; reason: "format" | "unmatched" | "ambiguous" | "duplicate" };

/**
 * Pair each name with the one file it records, or say why not.
 *
 * `files` is every file the section can address in the language. A name that two files
 * flatten to is ambiguous rather than guessed at, and two names for one file are both
 * refused, since which of them should ship is the actor's call.
 */
export function matchUploads(source: Source, names: readonly string[], files: Iterable<string>): Match[] {
  const byStem = new Map<string, string[]>();
  for (const file of files) {
    const stem = recordingStem(source, file).toLowerCase();
    const known = byStem.get(stem);
    if (known) known.push(file);
    else byStem.set(stem, [file]);
  }

  const matches: Match[] = names.map((name) => {
    const { stem, format } = parseUploadName(name);
    if (!format) return { name, file: null, reason: "format" };
    const candidates = byStem.get(stem) ?? [];
    if (candidates.length === 0) return { name, file: null, reason: "unmatched" };
    if (candidates.length > 1) return { name, file: null, reason: "ambiguous" };
    return { name, file: candidates[0], format };
  });

  const claimed = new Map<string, number>();
  for (const match of matches) if (match.file) claimed.set(match.file, (claimed.get(match.file) ?? 0) + 1);
  return matches.map((match) =>
    match.file && claimed.get(match.file)! > 1
      ? { name: match.name, file: null, reason: "duplicate" as const }
      : match,
  );
}
