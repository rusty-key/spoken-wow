/**
 * One fish.audio speech request, as tts.ts is one ElevenLabs request.
 *
 * Voices are zero-shot: every request carries each speaker's reference clip and its exact
 * transcript, so nothing has to exist in the spending account first. That is also why the
 * body is msgpack -- fish.audio takes inline references only as msgpack, never JSON.
 *
 * Several speakers are one request, not several: the turns are joined with fish.audio's
 * `<|speaker:N|>` tags and it returns one file.
 *
 * Several paragraphs are several requests. fish.audio's S2 models fill a paragraph break
 * with a sound nobody wrote -- a laugh, a moan, a mumble -- in roughly a third of takes, and
 * flattening the break removes the sound and the pause with it: fish.audio pauses no longer
 * there than at any full stop, and neither [pause] nor [long pause] changes that. So each
 * paragraph is spoken on its own and the parts are joined with a silence of our choosing
 * (stitch.ts, which re-encodes, so the result measures right).
 *
 * Every request goes to the timed endpoint, which says when each word starts at no extra cost.
 */
import { encode } from "@msgpack/msgpack";

import { fishConfig, type FishOptions } from "@/lib/voices/fish";

import { classifyFish, failure, type Failure } from "./errors";
import { PARAGRAPH_BREAK } from "./speakers/shape";
import { stitchMp3 } from "./stitch";
import { wordStarts, type WordStart } from "./word-times";

/**
 * The silence between two paragraphs, in seconds.
 *
 * fish.audio leaves about 0.06 s of silence at the start of a take and none at the end, so
 * this is very nearly the pause heard. A full stop inside a paragraph pauses about 0.47 s.
 */
export const PARAGRAPH_PAUSE_SEC = 0.9;

/** 10-30 seconds of one voice, and exactly what is said in it. */
export type FishReference = { audio: Buffer; text: string };

export type FishSettings = {
  model: string;
  temperature: number;
  topP: number;
  speed: number;
};

/** fish.audio's own defaults, which a collaborator who has set nothing gets. */
export const FISH_DEFAULTS = { temperature: 0.7, topP: 0.7, speed: 1 } as const;

export type FishSpeechRequest = {
  /** In order; `speaker` indexes `references`. */
  turns: { text: string; speaker: number }[];
  /** One clip per speaker. */
  references: FishReference[];
  settings: FishSettings;
};

/**
 * The text as fish.audio is sent it, and billed for.
 *
 * One speaker is sent bare. More are tagged at every turn, including the first, because the
 * tag is what says which reference a stretch is spoken from.
 */
export function fishText(request: Pick<FishSpeechRequest, "turns" | "references">): string {
  if (request.references.length === 1) return request.turns.map((turn) => turn.text).join(" ");
  return request.turns.map((turn) => `<|speaker:${turn.speaker}|>${turn.text}`).join("");
}

export function buildFishPayload(request: FishSpeechRequest): Record<string, unknown> {
  const { settings } = request;
  const single = request.references.length === 1;
  return {
    text: fishText(request),
    // fish.audio takes a list of clips for one speaker and a list of lists for several, the
    // outer index being the N of `<|speaker:N|>`. No reference_id: fish.audio looks every id
    // up as a saved model and answers 400 "Reference not found" for anything else.
    references: single ? request.references : request.references.map((clip) => [clip]),
    temperature: settings.temperature,
    top_p: settings.topP,
    prosody: { speed: settings.speed },
    // What ElevenLabs returns today, so a pack is one format whichever made its files, and
    // package-audio.sh transcodes both the same way.
    format: "mp3",
    sample_rate: 44100,
    mp3_bitrate: 128,
    // Quality over time-to-first-byte: nothing here is streamed to a listener.
    latency: "normal",
    normalize: true,
  };
}

export type FishSpeechResult =
  | {
      ok: true;
      audio: Buffer;
      bytes: number;
      /** Each spoken word's start in `audio`, or null when fish.audio did not time all of it. */
      words: WordStart[] | null;
    }
  | { ok: false; failure: Failure };

/**
 * The request as one request per paragraph, in order.
 *
 * A turn with a break in it is cut there, so a paragraph may hold the ends of several turns.
 * Each part carries only the references its own turns use, renumbered from 0, because
 * fish.audio reads `<|speaker:N|>` against the references it is sent, and a part spoken by
 * one voice is then sent bare, as a single-speaker line always is.
 */
export function paragraphs(request: FishSpeechRequest): FishSpeechRequest[] {
  const parts: FishSpeechRequest["turns"][] = [[]];
  for (const turn of request.turns) {
    turn.text.split(PARAGRAPH_BREAK).forEach((piece, i) => {
      if (i > 0) parts.push([]);
      const text = piece.trim();
      if (text) parts[parts.length - 1].push({ text, speaker: turn.speaker });
    });
  }
  return parts
    .filter((turns) => turns.length > 0)
    .map((turns) => {
      const used = [...new Set(turns.map((turn) => turn.speaker))];
      return {
        turns: turns.map((turn) => ({ text: turn.text, speaker: used.indexOf(turn.speaker) })),
        references: used.map((speaker) => request.references[speaker]),
        settings: request.settings,
      };
    });
}

/**
 * The line, spoken: one request per paragraph, one after another, joined into one mp3.
 *
 * In turn rather than at once, because fish.audio limits the requests an account has in
 * flight and the batch's concurrency is already set to that limit. Any part failing fails the
 * line: half a line is not a take. The bytes are every part's, which is what is billed.
 *
 * A part's times start after every part and pause before it, each part measured as fish.audio
 * timed it. One part without times leaves the whole line without: the words after it could
 * not be placed.
 */
export async function fishSpeech(
  request: FishSpeechRequest,
  options: FishOptions & { stitch?: typeof stitchMp3 } = {},
): Promise<FishSpeechResult> {
  const parts = paragraphs(request);
  if (parts.length <= 1) {
    const spoken = await speakOnce(parts[0] ?? request, options);
    return spoken.ok ? { ok: true, audio: spoken.audio, bytes: spoken.bytes, words: spoken.words } : spoken;
  }

  const audio: Buffer[] = [];
  let bytes = 0;
  let words: WordStart[] | null = [];
  let offset = 0;
  for (const part of parts) {
    const spoken = await speakOnce(part, options);
    if (!spoken.ok) return spoken;
    audio.push(spoken.audio);
    bytes += spoken.bytes;
    if (words && spoken.words && spoken.durationSec !== null) {
      for (const word of spoken.words) words.push({ word: word.word, start: word.start + offset });
      offset += spoken.durationSec + PARAGRAPH_PAUSE_SEC;
    } else {
      words = null;
    }
  }
  try {
    const joined = await (options.stitch ?? stitchMp3)(audio, PARAGRAPH_PAUSE_SEC);
    return { ok: true, audio: joined, bytes, words };
  } catch (error) {
    return {
      ok: false,
      failure: failure("upstream", error instanceof Error ? error.message : String(error)),
    };
  }
}

type SpokenPart =
  | { ok: true; audio: Buffer; bytes: number; words: WordStart[] | null; durationSec: number | null }
  | { ok: false; failure: Failure };

async function speakOnce(request: FishSpeechRequest, options: FishOptions): Promise<SpokenPart> {
  if (!options.apiKey) {
    // "auth" because it is fatal to a batch: every later job would fail the same way.
    return { ok: false, failure: failure("auth", "no fish.audio key was supplied for this request") };
  }
  const { apiKey, baseUrl, fetchImpl } = fishConfig(options);
  const payload = buildFishPayload(request);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/tts/stream/with-timestamp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/msgpack",
        // The model is a header, not a field. An unknown one silently falls back to
        // s2.1-pro, so validating the setting is the only guard against paying for a model
        // nobody chose.
        model: request.settings.model,
      },
      body: encode(payload),
    });
  } catch (error) {
    // DNS, TLS, a dropped connection: the next line may well get through.
    return {
      ok: false,
      failure: failure("upstream", `could not reach fish.audio: ${message(error)}`),
    };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    return { ok: false, failure: classifyFish(response.status, raw, "generating the line") };
  }

  // An error served with a 200 would otherwise be archived as an mp3 and play as silence.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/event-stream")) {
    const raw = await response.text().catch(() => "");
    return {
      ok: false,
      failure: failure(
        "upstream",
        `fish.audio answered 200 with ${contentType || "no content type"} rather than an event stream: ${raw.slice(0, 200)}`,
      ),
    };
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    // The stream dropped part way: what arrived is part of a take, not a take.
    return {
      ok: false,
      failure: failure("upstream", `fish.audio's stream broke off: ${message(error)}`),
    };
  }
  const timed = readTimedStream(raw);
  if ("error" in timed) return { ok: false, failure: failure("upstream", timed.error) };

  // What fish.audio bills: the UTF-8 bytes of the text, speaker tags included.
  return { ok: true, ...timed, bytes: Buffer.byteLength(payload.text as string, "utf8") };
}

type TimedEvent = {
  audio_base64: string;
  alignment: { segments: { text: string; start: number }[]; audio_duration: number } | null;
  chunk_seq: number;
  chunk_audio_offset_sec: number;
};

type TimedStream = { audio: Buffer; words: WordStart[] | null; durationSec: number | null };

/**
 * The audio and word starts of a timed stream.
 *
 * Each text chunk's alignment arrives as snapshots, each replacing the last, timed from the
 * chunk's own start. A chunk still without one at the end leaves the take without times.
 * An event that is not an audio chunk is skipped: the take is already billed, and failing it
 * over a closing or keep-alive event would throw the audio away.
 */
export function readTimedStream(raw: string): TimedStream | { error: string } {
  const audio: Buffer[] = [];
  const chunks = new Map<number, TimedEvent>();
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const field = (name: string) =>
      lines
        .filter((line) => line.startsWith(`${name}:`))
        .map((line) => line.slice(name.length + 1).replace(/^ /, ""));
    const data = field("data").join("\n");
    if (field("event")[0] === "error") {
      return { error: `fish.audio's stream reported an error: ${errorText(data)}` };
    }
    if (!data) continue;
    let event: TimedEvent;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (typeof event?.audio_base64 !== "string" || typeof event.chunk_seq !== "number") continue;
    audio.push(Buffer.from(event.audio_base64, "base64"));
    const known = chunks.get(event.chunk_seq);
    if (!known || event.alignment) chunks.set(event.chunk_seq, event);
  }
  const joined = Buffer.concat(audio);
  if (joined.byteLength === 0) return { error: "fish.audio's stream held no audio" };

  const ordered = [...chunks.values()].sort((a, b) => a.chunk_seq - b.chunk_seq);
  if (!ordered.every((chunk) => chunk.alignment)) {
    return { audio: joined, words: null, durationSec: null };
  }
  let durationSec = 0;
  const segments: { text: string; start: number }[] = [];
  for (const { alignment, chunk_audio_offset_sec: offset } of ordered) {
    for (const segment of alignment!.segments) {
      segments.push({ text: segment.text, start: segment.start + offset });
    }
    durationSec = Math.max(durationSec, offset + alignment!.audio_duration);
  }
  return { audio: joined, words: segmentWords(segments), durationSec };
}

/** A phoneme span, or any other `<|...|>` tag. */
const TAG = /<\|phoneme_start\|>([\s\S]*?)<\|phoneme_end\|>|<\|[^|]*\|>/g;

/**
 * The shown words of fish.audio's segments, read as one stream rather than segment by
 * segment: a tag or direction with spaces in it may be split across segments, and a segment
 * may hold two words joined at a speaker tag (`this.<|speaker:1|>He`).
 *
 * A phoneme span stands for the one word it replaced, so it is one word. A speaker tag
 * starts a new word. Bracketed directions are left to wordStarts, which drops them.
 */
function segmentWords(segments: { text: string; start: number }[]): WordStart[] {
  let text = "";
  const times: number[] = [];
  for (const segment of segments) {
    const piece = (text ? " " : "") + segment.text;
    text += piece;
    for (let i = 0; i < piece.length; i++) times.push(segment.start);
  }

  const characters: string[] = [];
  const starts: number[] = [];
  const breaks: number[] = [];
  const keep = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      characters.push(text[i]);
      starts.push(times[i]);
    }
  };
  let at = 0;
  for (const match of text.matchAll(TAG)) {
    keep(at, match.index);
    if (match[1] !== undefined) {
      for (const char of match[1].replace(/\s+/g, "")) {
        characters.push(char);
        starts.push(times[match.index]);
      }
    } else {
      breaks.push(characters.length);
    }
    at = match.index + match[0].length;
  }
  keep(at, text.length);
  return wordStarts({ characters, character_start_times_seconds: starts }, breaks);
}

function errorText(data: string): string {
  try {
    const parsed = JSON.parse(data) as { message?: unknown };
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // Not JSON: the text is the message.
  }
  return data.slice(0, 200) || "no message";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
