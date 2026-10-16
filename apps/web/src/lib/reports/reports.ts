/**
 * What a report is, in terms both the server and the browser can hold.
 *
 * Free of node imports on purpose: the form is a client component and needs the labels, and
 * importing anything that reaches for the filesystem would drag node:fs into the browser
 * bundle. Same reasoning as the note atop lib/line-fields.ts.
 */

import type { Source } from "@/lib/sections";

export const CATEGORIES = [
  "pronunciation",
  "wrong_voice",
  "audio_quality",
  "missing",
  "wrong_text",
  "other",
] as const;

export const STATUSES = ["open", "fixed", "not_an_issue"] as const;


export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  quests: "Quests",
  zones: "Places",
  books: "Readables",
};

/** Written for a player rather than an editor: the reporter is not reading the schema. */
export const CATEGORY_LABELS: Record<Category, string> = {
  pronunciation: "Said a word wrong",
  wrong_voice: "Wrong voice for this character",
  audio_quality: "Cut off, garbled or noisy",
  missing: "No voiceover played at all",
  wrong_text: "Read text that is not what the NPC says",
  other: "Something else",
};

/**
 * The same six, as a triage column rather than a sentence.
 *
 * The labels above are written for the player filing the report and read as complaints;
 * in a table they wrap to four lines and push every row apart. Triage is a scan down a
 * column, so here each one is the two words that tell them apart.
 */
export const CATEGORY_COLUMN: Record<Category, string> = {
  pronunciation: "Pronunciation",
  wrong_voice: "Wrong voice",
  audio_quality: "Audio quality",
  missing: "No audio",
  wrong_text: "Wrong text",
  other: "Other",
};

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  fixed: "Fixed",
  not_an_issue: "Not a problem",
};

/** Short enough that a paste of an entire log is refused rather than stored. */
export const BODY_MAX = 4000;

const NAME_MAX = 200;
const EMAIL_MAX = 320;

export type Report = {
  id: number;
  source: Source;
  lineId: string | null;
  /** The raw address the report came in on, or null where the source has none. */
  target: string | null;
  category: Category;
  body: string;
  status: Status;
  userId: string | null;
  name: string | null;
  email: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Truncated rather than rejected: losing the tail of a long name beats losing the report. */
export function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function validateSubmission(
  input: unknown,
):
  | {
      ok: true;
      value: { category: Category; body: string; name: string | null; email: string | null };
    }
  | { ok: false; error: string } {
  const submitted = (input ?? {}) as Record<string, unknown>;

  if (!isCategory(submitted.category)) return { ok: false, error: "unknown category" };

  const text = typeof submitted.body === "string" ? submitted.body.trim() : "";
  if (!text) return { ok: false, error: "body is required" };
  if (text.length > BODY_MAX) return { ok: false, error: "body is too long" };

  return {
    ok: true,
    value: {
      category: submitted.category,
      body: text,
      name: optionalText(submitted.name, NAME_MAX),
      email: optionalText(submitted.email, EMAIL_MAX),
    },
  };
}
