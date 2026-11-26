/**
 * Designs made with scratch scripts, brought in once through the site by an admin, one version
 * folder per request: data only comes home from production, so nothing writes these rows but the site.
 *
 * A folder is `<slot>-v<n>/` holding meta.json, preview<k>.mp3 and line<k>.mp3, as the scratch
 * scripts wrote it; its verdicts are that folder's entry in reviews.json.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { isVoiceSlot } from "@/lib/voices/slots";

import { DesignError } from "./access";
import { keepDesignAudio } from "./audio";
import { importDesign } from "./store";
import type { ClipMark, Measures } from "./types";

export type ImportFile = { name: string; data: Buffer };

type Meta = {
  slot: string;
  version: number;
  name?: string;
  voice_id?: string;
  prompt: string;
  preview_text: string;
  preview_ids?: string[];
  chosen_preview?: number;
  lines?: { file: string; npc?: string; text: string; lineId?: string }[];
  model_id?: string;
  /** The voice was deleted from the account to free a slot. */
  voice_deleted?: boolean;
  /** Per preview, as scripts/voice_measure.py measures them. */
  preview_metrics?: { ess?: unknown; decay?: unknown; level?: unknown }[];
  note?: string;
  analysis?: Record<string, unknown>;
};

type RoundOneReview = { at?: string; status?: string; note?: string; best_preview?: number | null; clips?: Record<string, string> };

export type ImportedVersion = {
  meta: Meta;
  previews: Buffer[];
  lines: { file: string; lineId: string; text: string; npcName: string | null; audio: Buffer }[];
  reviews: { status: "good" | "needs-work"; note: string; bestPreview: number | null; clips: Record<string, ClipMark>; at: string | null }[];
};

/** "2026-11-26 16:48", the scratch page's local time, as a timestamp Postgres reads. */
const when = (at: string | undefined) => (at && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at) ? `${at}:00` : null);

/** The scratch page marked clips by file name: `line2.mp3` is the second sample, `preview0.mp3` the first preview. */
function clipKey(key: string, lines: { file: string }[]): string | null {
  if (/^(sample|preview):\d+$/.test(key)) return key;
  const preview = /^preview(\d+)\.mp3$/.exec(key);
  if (preview) return `preview:${preview[1]}`;
  const position = lines.findIndex((line) => line.file === key);
  return position >= 0 ? `sample:${position}` : null;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function metricsOf(raw: { ess?: unknown; decay?: unknown; level?: unknown } | undefined): Measures | null {
  if (!raw) return null;
  const metrics = { ess: num(raw.ess), decay: num(raw.decay), level: num(raw.level) };
  return Object.values(metrics).some((v) => v !== undefined) ? metrics : null;
}

/** One folder, checked. Throws a DesignError naming what is missing. */
export function parseVersion(files: ImportFile[], reviews: unknown): ImportedVersion {
  const byName = new Map(files.map((file) => [file.name.split("/").at(-1)!, file.data]));
  const rawMeta = byName.get("meta.json");
  if (!rawMeta) throw new DesignError("the folder has no meta.json", 400);
  let meta: Meta;
  try {
    meta = JSON.parse(rawMeta.toString("utf8")) as Meta;
  } catch {
    throw new DesignError("meta.json is not JSON", 400);
  }
  if (typeof meta.slot !== "string" || !Number.isInteger(meta.version) || typeof meta.prompt !== "string" || typeof meta.preview_text !== "string") {
    throw new DesignError("meta.json needs slot, version, prompt and preview_text", 400);
  }

  const previews: Buffer[] = [];
  for (let k = 0; byName.has(`preview${k}.mp3`); k++) previews.push(byName.get(`preview${k}.mp3`)!);
  if (previews.length === 0) throw new DesignError(`${meta.slot}-v${meta.version} has no previews`, 400);

  const lines = (meta.lines ?? []).flatMap((line) => {
    const audio = byName.get(line.file);
    return audio && line.lineId ? [{ file: line.file, lineId: line.lineId, text: line.text, npcName: line.npc ?? null, audio }] : [];
  });

  const verdicts = (Array.isArray(reviews) ? (reviews as RoundOneReview[]) : []).flatMap((review): ImportedVersion["reviews"] => {
    if (review.status !== "good" && review.status !== "needs-work") return [];
    const clips = Object.fromEntries(
      Object.entries(review.clips ?? {}).flatMap(([key, mark]) => {
        const value = mark === "up" || mark === "good" ? "good" : mark === "down" || mark === "off" ? "off" : null;
        const clip = clipKey(key, lines);
        return value && clip ? [[clip, value as ClipMark]] : [];
      }),
    );
    const best = review.best_preview;
    return [{
      status: review.status,
      note: (review.note ?? "").trim(),
      bestPreview: Number.isInteger(best) && best! >= 0 && best! < previews.length ? best! : null,
      clips,
      at: when(review.at),
    }];
  });

  return { meta, previews, lines, reviews: verdicts };
}

/** Creates the version, or skips one the team already has: importing twice changes nothing. */
export async function importVersion(version: ImportedVersion, input: { lang: Lang; userId: string }): Promise<{ id: string | null; name: string }> {
  const { meta } = version;
  const name = `${meta.slot}-v${meta.version}`;
  if (!(await isVoiceSlot(meta.slot, input.lang))) throw new DesignError(`${meta.slot} is not a voice slot`, 400);

  // Every file first: keeping one twice is harmless, so a failure here leaves no row to block a retry.
  const shas = await Promise.all(version.previews.map((audio) => keepDesignAudio(audio, input.lang)));
  const samples = await Promise.all(
    version.lines.map(async (line, position) => ({
      position,
      sha256: await keepDesignAudio(line.audio, input.lang),
      lineId: line.lineId,
      text: line.text,
      npcName: line.npcName,
      characters: line.text.length,
      credits: null,
    })),
  );
  const chosen = meta.chosen_preview;
  const id = await importDesign({
    lang: input.lang,
    slot: meta.slot,
    version: meta.version,
    prompt: meta.prompt,
    previewText: meta.preview_text,
    previews: shas.map((sha256, i) => ({ generatedVoiceId: meta.preview_ids?.[i] ?? "", sha256, measures: metricsOf(meta.preview_metrics?.[i]) })),
    analysisId: null,
    userId: input.userId,
    chosenPreview: Number.isInteger(chosen) && chosen! >= 0 && chosen! < shas.length ? chosen! : null,
    voiceId: meta.voice_id ?? null,
    voiceName: meta.voice_id ? (meta.name ?? `design-${name}`) : null,
    sampleModel: meta.model_id ?? null,
    createdAt: version.reviews[0]?.at ?? null,
    note: typeof meta.note === "string" && meta.note.trim() ? meta.note.trim() : null,
    analysis: meta.analysis && typeof meta.analysis === "object" ? meta.analysis : null,
    voiceDeleted: meta.voice_deleted === true,
    samples,
    reviews: version.reviews.map((review) => ({ ...review, userId: input.userId })),
  });
  return { id, name };
}
