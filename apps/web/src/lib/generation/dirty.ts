/**
 * Audio that predates a pronunciation change.
 *
 * A lexicon edit changes how a name SOUNDS without changing a character of the text it
 * appears in, so no hash this project compares can see one: `spokenHash` on the quests side
 * and `textHash` on zones and books both move with the text and stand still with the
 * dictionary. Migration 0006 recorded `dictionaryVersion` on every take for exactly this
 * question, and until this module nothing read it.
 *
 * One module for all three sections, because `take`, `lexicon_change` and `take_ack` are
 * one set of tables and three copies of this rule would be three ways to drift.
 *
 * The rule, and each clause is a decision:
 *
 *   a take is dirty when some pronunciation change is NEWER than the take, names a word the
 *   take SPEAKS, and is newer than any acknowledgement of that file.
 *
 * Nothing here clears a mark on its own. A regeneration clears it for free -- the new take
 * postdates the change -- but the app never decides that audio nobody has listened to is
 * fine, because deciding that is the whole content of the mark.
 */
import { randomUUID } from "node:crypto";

import { recordActivities } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { kindOf, type LexiconEntry } from "./lexicon";
import type { Source } from "@/lib/sections";

/**
 * One save's worth of movement for one word. `changedAt` is epoch ms.
 *
 * `matcher` is the compiled pattern, filled in on first use and kept for the life of the
 * context - which is one request. A cache keyed by grapheme at module scope would be the
 * obvious alternative and is the wrong shape: it would outlive every request and grow with
 * every word ever edited, to save compiling a handful of patterns per sweep.
 */
export type LexiconChange = { grapheme: string; changedAt: number; matcher?: RegExp };

export type DirtyContext = {
  /** Newest first, which is the order the sweep below wants and the index serves. */
  changes: LexiconChange[];
  /** file -> when somebody last said this take is fine, epoch ms. */
  acks: Map<string, number>;
};

export const NO_DIRT: DirtyContext = { changes: [], acks: new Map() };

/** What the sweep needs to know about a take: what it says, and when it was made. */
export type SpokenTake = {
  file: string;
  text: string;
  /** Epoch ms, or null for inherited and imported audio, which nothing recorded. */
  generatedAt: number | null;
};

/**
 * A name, as it appears inside a line.
 *
 * Word boundaries, so an entry for Tauren does not mark every line saying "taurenoid" -- but
 * boundaries drawn at "not a letter or digit" rather than \b, because half the names this
 * lexicon exists for are written with an apostrophe. \b puts a boundary INSIDE Aku'mai and
 * none after "tauren" in "tauren's": the first would match half a name, the second would
 * miss a possessive, and the possessive is how the corpus writes most of them.
 */
function pattern(grapheme: string): RegExp {
  const escaped = normalise(grapheme).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * Curly apostrophes are the same apostrophe.
 *
 * The corpus is extracted from a world database that holds both, and an entry typed in the
 * editor will carry whichever one the keyboard produced. Two spellings of one name would
 * silently match nothing, which reads as "the lexicon edit had no effect".
 */
function normalise(text: string): string {
  return text.replace(/[‘’ʼ`]/g, "'");
}

/**
 * Of these takes, the ones a pronunciation change has overtaken.
 *
 * Pure, and takes the changes rather than reading them, so this is testable with no database
 * -- the split lib/search.ts and lib/zones/search.ts already make.
 *
 * The loop is over what CHANGED, not over the lexicon: the filter's normal case is a sweep
 * of the whole corpus, and a take older than no change at all is answered without its text
 * being read even once. Patterns are compiled per grapheme rather than per take, because a
 * sweep is 17,000 takes and a handful of words.
 */
export function dirtyFiles(takes: SpokenTake[], context: DirtyContext): Set<string> {
  const dirty = new Set<string>();
  if (!context.changes.length) return dirty;

  for (const take of takes) {
    if (isDirty(take, context)) dirty.add(take.file);
  }
  return dirty;
}

/**
 * The rule itself, for one take.
 *
 * The loop is over what CHANGED, not over the lexicon: a take older than no change at all is
 * answered without its text being read even once, which is what makes the whole-corpus
 * sweep behind the filter affordable.
 */
export function isDirty(take: SpokenTake, context: DirtyContext): boolean {
  // Unknown is not "before". Inherited and imported audio has no date, and calling all of it
  // dirty would mark most of the store on a claim nothing can support - 0006's argument
  // about a null hash, which is the same argument.
  if (take.generatedAt === null) return false;

  const since = Math.max(take.generatedAt, context.acks.get(take.file) ?? 0);
  let text: string | null = null;

  for (const change of context.changes) {
    if (change.changedAt <= since) continue;
    text ??= normalise(take.text);
    change.matcher ??= pattern(change.grapheme);
    if (change.matcher.test(text)) return true;
  }
  return false;
}

/**
 * The changes and the acknowledgements, for one section in one language. Two selects, both
 * small.
 *
 * Both halves are per language: a German lexicon edit says nothing about how an English take
 * sounds, and clearing the English take of a file does not clear the German one.
 */
export async function loadDirtyContext(
  source: Source,
  lang: Lang = BASE_LANG,
): Promise<DirtyContext> {
  const [changes, acks] = await Promise.all([
    db().query<{ grapheme: string; changedAt: Date }>(
      `select "grapheme", "changedAt" from "lexicon_change" where "lang" = $1
        order by "changedAt" desc`,
      [lang],
    ),
    db().query<{ file: string; ackedAt: Date }>(
      `select "file", "ackedAt" from "take_ack" where "source" = $1 and "lang" = $2`,
      [source, lang],
    ),
  ]);

  return {
    changes: changes.rows.map((row) => ({
      grapheme: row.grapheme,
      changedAt: row.changedAt.getTime(),
    })),
    acks: new Map(acks.rows.map((row) => [row.file, row.ackedAt.getTime()])),
  };
}

/**
 * Say that these takes are fine as they stand. Idempotent; a second clear moves the date.
 *
 * Several files are one click, logged as one "marks.cleared" row with every file's row
 * grouped under it for the page to fold (migration 0053). The marks and their log rows are
 * one transaction: a click's row lost while its files' rows landed would hide those files
 * from the log for good, so a failed log write fails the clear rather than being swallowed.
 */
export async function acknowledge(
  source: Source,
  files: string[],
  userId: string,
  lang: Lang = BASE_LANG,
): Promise<void> {
  if (!files.length) return;
  const groupId = files.length > 1 ? randomUUID() : null;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into "take_ack" ("source", "lang", "file", "ackedAt", "ackedBy")
       select $1, $4, unnest($2::text[]), now(), $3
       on conflict ("source", "lang", "file") do update set
         "ackedAt" = excluded."ackedAt",
         "ackedBy" = excluded."ackedBy"`,
      [source, files, userId, lang],
    );
    await recordActivities(
      [
        ...(groupId
          ? [{ kind: "marks.cleared" as const, lang, source, actorId: userId, detail: { groupId, count: files.length } }]
          : []),
        ...files.map((file) => ({
          kind: "take.acked" as const,
          lang,
          source,
          subject: file,
          actorId: userId,
          detail: groupId ? { groupId } : {},
        })),
      ],
      client,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * What a save did to one word. `kind` mirrors lexicon_change."kind"; `before` and `after`
 * are the rule as a person reads it (see `said`), for the activity log -- lexicon_change
 * keeps only the word, and the row the rule lived in is overwritten by the save.
 */
export type SoundChange = {
  grapheme: string;
  kind: "added" | "edited" | "removed";
  before?: string;
  after?: string;
};

/**
 * What a save changed about how words SOUND.
 *
 * Notes and confidences are excluded deliberately, and they are most of what the editor is
 * used for: a lexicon page is read to see what is still unverified, and somebody writing
 * down why an entry exists must not mark 9,000 files dirty. Only the rule ElevenLabs is
 * sent - the alias, the IPA, and which of the two an entry is - reaches anyone's ears.
 *
 * Keyed case-insensitively, because that is how the matcher and ElevenLabs both read a
 * grapheme: re-capitalising an entry is not a removal and an addition.
 */
export function soundChanges(previous: LexiconEntry[], next: LexiconEntry[]): SoundChange[] {
  const before = new Map(previous.map((entry) => [entry.grapheme.toLowerCase(), entry]));
  const after = new Map(next.map((entry) => [entry.grapheme.toLowerCase(), entry]));

  const changes: SoundChange[] = [];

  for (const [key, entry] of after) {
    const was = before.get(key);
    if (!was) changes.push({ grapheme: entry.grapheme, kind: "added", after: said(entry) });
    else if (sound(was) !== sound(entry)) {
      changes.push({ grapheme: entry.grapheme, kind: "edited", before: said(was), after: said(entry) });
    }
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) changes.push({ grapheme: entry.grapheme, kind: "removed", before: said(entry) });
  }

  return changes;
}

/** Everything about an entry that an ear can tell apart, as one comparable string. */
function sound(entry: LexiconEntry): string {
  return `${kindOf(entry)}:${entry.alias ?? entry.ipa ?? ""}`;
}

/**
 * The same rule as somebody reading the log would write it: an alias as it is, IPA between
 * slashes, the way a dictionary sets it off -- which is also what tells "toren" the alias
 * apart from an IPA string that happens to spell the same.
 */
function said(entry: LexiconEntry): string {
  return kindOf(entry) === "alias" ? (entry.alias ?? "") : `/${entry.ipa ?? ""}/`;
}

/**
 * Record what a save changed, at the moment it was saved.
 *
 * AT SAVE, NOT AT SYNC. The save is the human act, and it is what a take's date has to be
 * compared against; the upload can fail, be retried, or be carried by a later save, and
 * making the record wait on it would mean a failed upload quietly loses the fact that the
 * rule moved. `versionId` is filled in for provenance when the sync that carried the change
 * succeeds, and stays null when it did not - which is the honest record of a real state.
 */
export async function logSoundChanges(
  changes: SoundChange[],
  changedBy: string,
  versionId: string | null,
  lang: Lang = BASE_LANG,
): Promise<void> {
  if (!changes.length) return;
  await db().query(
    `insert into "lexicon_change" ("grapheme", "kind", "versionId", "changedBy", "lang")
     select "grapheme", "kind", $3, $4, $5
       from unnest($1::text[], $2::text[]) as c("grapheme", "kind")`,
    [changes.map((c) => c.grapheme), changes.map((c) => c.kind), versionId, changedBy, lang],
  );
  // After lexicon_change and outside any transaction, like it: there is none to join, and a
  // log that failed to land must not undo the record the dirty marks are computed from.
  await recordActivities(
    // An added word has no before and a removed one no after; undefined is dropped from the
    // stored detail, so one shape serves all three kinds.
    changes.map((change) => ({
      kind: `lexicon.${change.kind}` as const,
      lang,
      actorId: changedBy,
      subject: change.grapheme,
      detail: { before: change.before, after: change.after },
    })),
  );
}
