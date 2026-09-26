/**
 * Every kind of act the activity log records, and what each one carries.
 *
 * The table stores `detail` as jsonb (migration 0050), so this is where its shape is
 * decided. Declared as one map from kind to detail so that a writer naming a kind gets its
 * detail checked by the compiler, and a kind added here shows up as a type error in the
 * page's describer until it says how to read it.
 *
 * Browser-safe on purpose: the page's filters and rows import it too.
 *
 * Rows backfilled from the tables that came before are thinner than rows written since --
 * a lexicon change with no before or after, a text edit with no previous version -- so
 * every field a backfill could not supply is optional.
 */
import type { Capability } from "@/lib/permissions";

export type ActivityDetail = {
  // Audio.
  "take.generated": {
    version: number;
    provider?: string;
    credits?: number | null;
    costUsd?: number | null;
    /** The queue batch that cut it, when the queue did. The page folds these under the batch. */
    batchId?: string;
  };
  "take.restored": { version: number; from?: number | null };
  /** `groupId` when the take was one of several cleared in one click; the page folds it there. */
  "take.acked": { groupId?: string };
  "marks.cleared": { groupId: string; count: number };
  "batch.queued": { batchId: string; label?: string | null; count: number };
  "batch.stopped": { batchId?: string; label?: string | null; reason?: string | null; cancelled?: number };

  // Text and pronunciation.
  "text.edited": {
    version: number;
    text?: string;
    short?: string | null;
    note?: string | null;
    variant?: number;
    origin?: string;
  };
  "text.restored": { version: number; from?: number | null };
  "name.edited": { version: number; name?: string; note?: string | null };
  "lexicon.added": { after?: string };
  "lexicon.edited": { before?: string; after?: string };
  "lexicon.removed": { before?: string };
  "override.set": { text: string; before?: string | null };
  "override.cleared": { before?: string | null };
  "ignore.set": { reason?: string | null };
  "ignore.cleared": Record<string, never>;
  "setting.changed": { setting: string };

  // Voices.
  "voice.cloned": { voiceId?: string; sampleCount?: number | null };
  "reference.set": { sample?: string; transcript?: string | null };
  "reference.edited": { transcript?: string | null };
  "reference.deleted": Record<string, never>;
  "sample.added": { files: string[] };
  "sample.deleted": { files: string[] };
  "sample.imported": { files: string[] };
  "sample.merged": { files: string[]; into?: string };
  "npc.resolved": {
    npcName?: string | null;
    race?: string | null;
    gender?: string | null;
    flavor?: string | null;
  };

  // Admin.
  "grant.added": { capability: Capability };
  "grant.removed": { capability: Capability };
  "language.toggled": { enabled: boolean };
  "contribution.resolved": { status: string; key?: string };
  "contribution.edited": { field: string; value?: unknown };
  "report.resolved": { status: string; category?: string };

  // Accounts, through better-auth's admin plugin rather than this app's routes. Every
  // language's, so a global admin's alone to read: see `global` in store.ts.
  /** `role` as set-role received it: one role, or several joined with ", ". */
  "user.role_changed": { role: string };
  "user.banned": { banReason?: string; banExpiresIn?: number };
  "user.unbanned": Record<string, never>;
  "user.removed": Record<string, never>;
  "user.impersonated": Record<string, never>;
};

export type ActivityKind = keyof ActivityDetail;

export const CATEGORIES = ["audio", "text", "voices", "admin"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Which filter each kind falls under, by the part before the dot. Exhaustive over the
 * prefixes so that a new family of kinds has to be placed somewhere.
 */
const CATEGORY_OF: Record<string, Category> = {
  take: "audio",
  batch: "audio",
  marks: "audio",
  text: "text",
  name: "text",
  lexicon: "text",
  override: "text",
  ignore: "text",
  setting: "text",
  voice: "voices",
  reference: "voices",
  sample: "voices",
  npc: "voices",
  grant: "admin",
  language: "admin",
  contribution: "admin",
  report: "admin",
  user: "admin",
};

export function categoryOf(kind: string): Category | null {
  return CATEGORY_OF[kind.split(".")[0]] ?? null;
}

/** The kind prefixes one category covers, for filtering in SQL. */
export function prefixesOf(category: Category): string[] {
  return Object.entries(CATEGORY_OF)
    .filter(([, value]) => value === category)
    .map(([prefix]) => prefix);
}
