/**
 * The file a recording request is about, checked against the section's own list.
 *
 * Every recording route names a file by `source` and `file` and acts in the language its
 * `?lang=` says. The file is whitelisted rather than inspected, as takes/files.ts explains:
 * a path some line in that language owns, or a 404.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { isSource, type Source } from "@/lib/sections";

import { recordableFiles } from "./store";

export type Target = { source: Source; file: string; lineId: string };

export async function recordingTarget(
  source: unknown,
  file: unknown,
  lang: Lang,
): Promise<{ target: Target; denied: null } | { target: null; denied: Response }> {
  if (!isSource(source) || typeof file !== "string" || !file) {
    return { target: null, denied: new Response("bad recording", { status: 400 }) };
  }
  const lineId = (await recordableFiles(source, lang)).get(file);
  if (!lineId) return { target: null, denied: new Response("unknown file", { status: 404 }) };
  return { target: { source, file, lineId }, denied: null };
}
