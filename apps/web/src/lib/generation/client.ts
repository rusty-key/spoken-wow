/**
 * The browser's half of regeneration.
 *
 * Deliberately free of node imports: this is loaded into the client bundle, so anything it
 * touches is too. Types are re-declared rather than imported from the server modules for the
 * same reason - importing a type is erased, but importing the module it lives beside is not
 * always, and the production build is the only thing that catches the difference.
 */

import { BASE_LANG, withLang, type Lang } from "@/lib/lang";
import { noApiKeyMessage } from "@/lib/no-api-key";
import type { Source } from "@/lib/sections";
import type { Rate } from "./billing";
import type { Provider } from "./providers";
import type { QueueLine } from "./queue-line";


export type FailureKind =
  | "quota"
  | "auth"
  | "rate-limit"
  | "voice-missing"
  | "bad-request"
  | "upstream";

export type RegenerateOk = {
  ok: true;
  lineId: string;
  file: string;
  version: number;
  bytes: number;
  characters: number;
  /** Exactly what ElevenLabs charged, from its response header. null when it did not say. */
  credits: number | null;
  seed: number | null;
  voice: string;
  spokenText: string;
  sharedWith: number;
};

export type RegenerateFailed = {
  ok: false;
  kind: FailureKind;
  message: string;
  /** Whether the rest of a batch is worth attempting. */
  fatal: boolean;
};

export type RegenerateResponse = RegenerateOk | RegenerateFailed;

export type GenerationStatusResponse = {
  voices: string[];
  subscription: {
    tier: string;
    characterCount: number;
    characterLimit: number;
    resetAt: string | null;
  } | null;
  error: string | null;
  /**
   * Whether the signed-in user has no ElevenLabs key on file.
   *
   * Distinct from `error`, which is ElevenLabs refusing a key that exists. This one is the
   * state every new collaborator starts in, and the fix is one page away rather than a
   * support question - so the explorer names it instead of showing an upstream message.
   */
  noApiKey: boolean;
  settings: {
    modelId: string;
    voiceSettings: Record<string, number | boolean>;
    seedStrategy: string;
  };
  /**
   * Credits per character, or dollars for fish.audio, calibrated from what this account has
   * actually been charged.
   *
   * `samples: 0` means nothing has been generated with this model yet and the list rate is
   * standing in - an upper bound, not a measurement.
   */
  rate: Rate;
  /** Which generator the signed-in user spends with. */
  provider: Provider;
  /** fish.audio's balance in dollars, for a fish.audio user; null when it could not be read. */
  wallet?: { credit: number } | null;
  /**
   * For an ElevenLabs user, the voices pinned to fish.audio in this language, whose lines
   * fish.audio speaks on their fish.audio key: its references, whether they have that key,
   * and its rate. Absent or null when nothing is pinned.
   */
  pinned?: { voices: string[]; references: string[]; noApiKey: boolean; rate: Rate } | null;
};

export async function fetchGenerationStatus(
  signal?: AbortSignal,
  lang: Lang = BASE_LANG,
): Promise<GenerationStatusResponse | null> {
  try {
    // Per language: which slots have a clone is the page's language's answer.
    const response = await fetch(withLang(lang, "/api/generation/status"), { signal });
    if (!response.ok) return null;
    return (await response.json()) as GenerationStatusResponse;
  } catch {
    // The page works without it: the balance goes unshown and no button is pre-disabled.
    return null;
  }
}

/** One unit of work in a batch. Mirrors BatchLine in lib/search.ts; see the note above. */
export type BatchJob = {
  lineId: string;
  audioPath: string;
  npcName: string;
  voice: string;
  characters: number;
  preview: string;
};

/** Mirrors BatchSkip in lib/search.ts. */
export type BatchSkip = "progress" | "untranslated" | "no-voice" | "invalid-chars" | "shared-file";

export type BatchJobs = {
  jobs: BatchJob[];
  /** Lines the filters matched, which is what the button counts. */
  matched: number;
  /** The matched lines that are not a job of their own, by reason. */
  skipped: Partial<Record<BatchSkip, number>>;
};

/**
 * Every job a set of filters would regenerate.
 *
 * The whole match set, not the page on screen: the confirmation dialog exists to say what
 * "regenerate all of this" costs, and a figure for the visible fifty would be a lie.
 */
export async function fetchBatchJobs(
  params: URLSearchParams,
  signal?: AbortSignal,
  lang: Lang = BASE_LANG,
): Promise<BatchJobs | null> {
  try {
    const response = await fetch(withLang(lang, `/api/quests/search/lines?${params}`), { signal });
    if (!response.ok) return null;
    return (await response.json()) as BatchJobs;
  } catch {
    return null;
  }
}

export async function regenerate(
  lineId: string,
  signal?: AbortSignal,
  lang: Lang = BASE_LANG,
): Promise<RegenerateResponse> {
  let response: Response;
  try {
    response = await fetch(withLang(lang, "/api/quests/regenerate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, kind: "upstream", message: message(error), fatal: false };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // A missing key is an auth failure, and fatal for the same reason a bad one is: every
    // remaining line in the batch would be refused by the same guard.
    const noKey = noApiKeyMessage(response.status, body as { error?: string; code?: string });
    if (noKey) return { ok: false, kind: "auth", message: noKey, fatal: true };

    return {
      ok: false,
      kind: (body.kind as FailureKind) ?? "upstream",
      message: (body.error as string) ?? `request failed (${response.status})`,
      // Defaults to stopping: an unrecognised failure repeated ninety more times is worse
      // than a batch that stops early and can be restarted.
      fatal: body.fatal !== false,
    };
  }

  return body as unknown as RegenerateOk;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The queue as the panel needs it. Mirrors QueueSnapshot in lib/generation/queue.ts.
 *
 * Re-declared rather than imported for the reason this file's header gives: that module
 * imports `pg`, and pulling it into the client graph fails only the production build.
 */
export type QueueSnapshot = {
  active: boolean;
  counts: Record<"pending" | "running" | "done" | "failed" | "cancelled", number>;
  credits: number;
  costUsd: number;
  unpriced: number;
  running: { source: Source; lang: Lang; lineId: string; npcName: string; preview: string }[];
  failures: { source: Source; lang: Lang; lineId: string; message: string }[];
  latestBatch: { cancelled: number; stoppedBecause: string | null } | null;
  /**
   * The languages paused now, and by whom. Optional for the reason `queues` is: an older
   * server omits it.
   */
  paused?: { lang: Lang; pausedAt: string; by: string | null }[];
  /**
   * Each owner's queue in drain order. Mirrors QueueSnapshot["queues"] in queue.ts.
   *
   * Optional although this release always sends it: an older server omits it, and a tab can
   * poll one during a pm2 reload or after a rollback.
   */
  queues?: QueueLine[];
  /**
   * Carries the source because two explorers poll one queue, and each may only adopt its
   * own: a quests page told that a places file is now at version 3 would look for a line it
   * does not have. The language for the same reason: an English page must not adopt a
   * Portuguese version number.
   */
  finished: { id: string; source: Source; lang: Lang; lineId: string; file: string; version: number }[];
  cursor: string;
  /** The newest settled job the panel is showing: what its X dismisses through. */
  through: string | null;
};

/** `batchId` is null when every line was already queued, so no batch was kept. */
export type QueuedBatch = { batchId: string | null; queued: number; skipped: number };

/**
 * Start a batch, or say why not.
 *
 * The quests half sends filters and the places half sends ids, which is the queue route's
 * distinction rather than this function's: quests re-derives the job set server-side so a
 * forty-thousand-line batch is a small request, while the places corpus is ~1,400 lines
 * selected by hand, where the ids ARE what the user picked.
 *
 * A string rather than null for the refusals that have something to tell the operator -
 * having no ElevenLabs key is the one that a new collaborator meets first, and "Could not
 * queue the batch" would send them looking in the wrong place.
 */
export async function queueBatch(
  request:
    | { source: "quests"; filters: URLSearchParams }
    // Both id-driven sections, for the same reason: their explorers already hold the set
    // of ids the visitor was shown, and quoting one set while queueing another is the
    // failure the quote exists to prevent.
    | { source: "places" | "readables"; lineIds: string[] },
  label: string,
  lang: Lang = BASE_LANG,
): Promise<QueuedBatch | { error: string } | null> {
  try {
    const response = await fetch(withLang(lang, "/api/regenerate/queue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        request.source === "quests"
          ? { source: "quests", filters: request.filters.toString(), label }
          : { source: request.source, lineIds: request.lineIds, label },
      ),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const noKey = noApiKeyMessage(response.status, body as { error?: string; code?: string });
      return noKey ? { error: noKey } : null;
    }
    return body as unknown as QueuedBatch;
  } catch {
    return null;
  }
}

export async function fetchQueue(
  since: string | null,
  signal?: AbortSignal,
): Promise<QueueSnapshot | null> {
  try {
    const params = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await fetch(`/api/regenerate/queue${params}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as QueueSnapshot;
  } catch {
    // A dropped poll is not an error worth showing: the next one is two seconds away and
    // the cursor has not moved, so nothing is missed.
    return null;
  }
}

/** Wave away finished work up to `through`, the newest settled job the panel was showing. */
export async function dismissQueue(through: string): Promise<void> {
  await fetch("/api/regenerate/queue/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ through }),
  }).catch(() => {});
}

export async function stopQueue(): Promise<void> {
  await fetch("/api/regenerate/queue/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
}

/** Hold the queue in the caller's languages, keeping what is waiting. */
export async function pauseQueue(): Promise<void> {
  await fetch("/api/regenerate/queue/pause", { method: "POST" }).catch(() => {});
}

/** Let a paused queue run again, in the caller's languages. */
export async function resumeQueue(): Promise<void> {
  await fetch("/api/regenerate/queue/resume", { method: "POST" }).catch(() => {});
}

/**
 * Say that these takes are fine as they stand, despite a pronunciation having moved under
 * them.
 *
 * One endpoint for all three sections, because the tables it writes are shared. Returns
 * whether it worked rather than throwing: the caller has already cleared the marks on
 * screen, and the worst case is a row that comes back marked on the next search.
 */
export async function clearDirty(
  source: string,
  files: string[],
  lang: Lang = BASE_LANG,
): Promise<boolean> {
  try {
    const response = await fetch(withLang(lang, "/api/dirty"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, files }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
