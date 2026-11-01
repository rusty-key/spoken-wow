/**
 * What a report is, in terms both the server and the browser can hold.
 *
 * Free of node imports on purpose: the form is a client component and needs the labels, and
 * importing anything that reaches for the filesystem would drag node:fs into the browser
 * bundle. Same reasoning as the note atop lib/line-fields.ts.
 */

import type { Lang } from "@/lib/lang";
import { can, type Capability, type Viewer } from "@/lib/permissions";
import type { ReportContext } from "@/lib/reports/context";
import type { Source } from "@/lib/sections";

export const CATEGORIES = [
  "pronunciation",
  "wrong_voice",
  "audio_quality",
  "missing",
  "wrong_text",
  "other",
] as const;

/** `minor` is set aside: not open, so nothing counts it, and not answered either. */
export const STATUSES = ["open", "minor", "fixed", "not_an_issue"] as const;


export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  quests: "Quests",
  places: "Places",
  readables: "Readables",
  bosses: "Bosses",
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
  minor: "Minor",
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
  /** What the player's addon said it saw, or null for a report that came without it. */
  context: ReportContext | null;
  queue: Queue;
};

/** Who a report waits for: the language's text maintainers, or the team voicing it. */
export const QUEUES = ["text", "audio"] as const;

export type Queue = (typeof QUEUES)[number];

export function isQueue(value: unknown): value is Queue {
  return typeof value === "string" && (QUEUES as readonly string[]).includes(value);
}

/** What somebody must hold in a report's language to act on a report in `queue`. */
export function queueCapability(queue: Queue): Capability {
  return queue === "text" ? "text" : "edit";
}

/** The queues somebody works in one language, for a list or a route to narrow to. */
export function queuesOf(viewer: Viewer | null, lang: Lang): Queue[] {
  return QUEUES.filter((queue) => can(viewer, queueCapability(queue), lang));
}

/**
 * What the triage pages show of the queues. Nothing while the language's two groups are the same
 * people, so a language where one group does both keeps today's page.
 *
 * `labelled`: this viewer sees one queue, and somebody else works the other.
 * `passTo`: the queues a report can be passed into; never one nobody works.
 */
export function queueView(
  queues: readonly Queue[],
  holders: Record<Queue, ReadonlySet<string>>,
): { labelled: boolean; passTo: Queue[] } {
  const same =
    holders.text.size === holders.audio.size && [...holders.text].every((user) => holders.audio.has(user));
  return {
    labelled: queues.length === 1 && holders[queues[0] === "text" ? "audio" : "text"].size > 0,
    passTo: same ? [] : QUEUES.filter((queue) => holders[queue].size > 0),
  };
}

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
