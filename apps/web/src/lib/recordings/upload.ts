/**
 * Sending one recording to /api/recordings, for the row's upload and the bulk drop zone.
 *
 * Browser-side. One file per request, as the route wants, with the route's refusal turned
 * into a sentence: an actor dropping forty files needs to read which three were refused and
 * why, not a status code.
 */
import { withLang, type Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

import { MAX_RECORDING_BYTES, parseUploadName } from "./match";

export async function uploadRecording(
  lang: Lang,
  target: { source: Source; file: string },
  audio: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Checked here as well as there, so a wrong file is refused before it is sent.
  if (!parseUploadName(audio.name).format) return { ok: false, error: `${audio.name} is not .mp3 or .ogg` };
  if (audio.size > MAX_RECORDING_BYTES) {
    return { ok: false, error: `${audio.name} is over ${MAX_RECORDING_BYTES / 1024 / 1024} MiB` };
  }

  const form = new FormData();
  form.set("source", target.source);
  form.set("file", target.file);
  form.set("audio", audio);
  try {
    const response = await fetch(withLang(lang, "/api/recordings"), { method: "POST", body: form });
    if (response.ok) return { ok: true };
    // The route answers its refusals as JSON; a proxy's 413 or a 404 is plain text.
    const text = await response.text();
    let error = text;
    try {
      error = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {}
    return {
      ok: false,
      error: response.status === 413 ? `${audio.name} is too large to upload` : error || `upload failed (${response.status})`,
    };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }
}

/** The URL one recording plays from. */
export function recordingAudioUrl(lang: Lang, source: Source, file: string, version: number): string {
  return withLang(lang, `/api/recordings/audio?${new URLSearchParams({ source, file, version: String(version) })}`);
}
