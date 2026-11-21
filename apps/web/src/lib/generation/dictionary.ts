/**
 * The lexicon in force, and the ElevenLabs dictionary it corresponds to.
 *
 * Unlike settings.ts, there is one layer and not two. The row IS the lexicon. It is seeded
 * once by migration 0008 and edited from the web UI thereafter, because that is how a
 * pronunciation actually gets fixed - someone hears a name come out wrong and corrects it.
 * A file shipping inside the release could only ever be a stale snapshot competing with
 * that, so there is no file: the seed lives inside migration 0008 and nothing reads a
 * lexicon off disk.
 *
 * What has no equivalent in settings.ts either way: a saved lexicon is inert until it has
 * been uploaded. Saving does two things that can fail independently, so the row records both
 * the entries and the locator they produced, and readLexicon reports a save that reached
 * Postgres but not ElevenLabs as exactly that rather than as success.
 *
 * The dictionary this uploads to is shared with ../wow-lore, which narrates a different
 * corpus on the same ElevenLabs account and gets the same names wrong. It names the
 * dictionary by id in tools/voice/config.json and pins a version, so the id has to be
 * stable across saves - which is what ELEVENLABS_DICTIONARY_ID and the in-place update
 * below are for. This is the only project that edits the lexicon; wow-lore reads it.
 *
 * ElevenLabs refuses a dictionary the key's account cannot read, and every collaborator generates
 * on their own key. So the row says what the editor last uploaded, and
 * lexicon_account_dictionary says where each account holds it.
 */
import { createHash } from "node:crypto";

import { query, TEAM_ROWS } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { queryAs, readAs } from "@/lib/teams/store";
import {
  addDictionaryRules,
  countLexemes,
  createPronunciationDictionary,
  DictionaryUnreadable,
  downloadPronunciationDictionary,
  readDictionary,
  removeDictionaryRules,
  type DictionaryLocator,
  type ElevenLabsOptions,
} from "@/lib/voices/elevenlabs";

import { graphemeCasings } from "./casings";
import { logSoundChanges, soundChanges } from "./dirty";
import { toRules, type DictionaryRule, type LexiconEntry } from "./lexicon";

export type LexiconSync = "synced" | "pending" | "never";

export type EffectiveLexicon = {
  entries: LexiconEntry[];
  /**
   * False when the table has no row at all.
   *
   * Only reachable if migration 0008 has not run, and worth reporting rather than rendering
   * as an empty lexicon: an editor with no rows is exactly what a failed deploy looked like
   * before, and it should say so instead of inviting someone to retype 134 entries.
   */
  seeded: boolean;
  /**
   * Whether the entries above are the ones ElevenLabs is holding.
   *
   * `never` means no dictionary has ever been uploaded, so generation applies none at all.
   * That is the state a freshly seeded row is in, and it is not the same as `pending`.
   * `pending` means a save was stored but its upload failed, so generation is still applying
   * the PREVIOUS locator - the editor has to say so, because the page would otherwise show
   * entries that are not the ones in effect. Collapsing the two would tell someone their
   * edit is queued behind an older dictionary when in fact nothing is being applied.
   */
  sync: LexiconSync;
  locator: DictionaryLocator | null;
  /**
   * Rules sent, and rules the stored dictionary actually holds.
   *
   * Equal is the only good answer. They differed silently for weeks - a phoneme rule carrying
   * case_sensitive:false is discarded without a word - so the page reports the pair rather
   * than trusting a 200. null on a lexicon uploaded before this was checked.
   */
  rulesSent: number | null;
  rulesKept: number | null;
  syncedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** A digest of the entries, null with no row: what a writer sends back to say what it read. */
  version: string | null;
};

type Row = {
  entries: LexiconEntry[];
  dictionaryId: string | null;
  versionId: string | null;
  rulesSent: number | null;
  rulesKept: number | null;
  /** Whether the dictionary in force was built from exactly these entries. See below. */
  inForce: boolean;
  digest: string;
  syncedDigest: string | null;
  syncedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

type UploadedRow = Row & DictionaryLocator;

function hasLocator(row: Row): row is UploadedRow {
  return Boolean(row.dictionaryId && row.versionId);
}

function locatorOf({ dictionaryId, versionId }: DictionaryLocator): DictionaryLocator {
  return { dictionaryId, versionId };
}

/**
 * Where a language's lexicon row is. English's is the english team's pronunciation_lexicon; every
 * other language has a row of its own in pronunciation_lexicon_locale (migration 0038), with
 * the same columns meaning the same things. `$1` is the language in both, unused for English,
 * so every statement below can be written once. Either row is its language's team's, so every
 * statement runs as that team.
 */
function rowOf(lang: Lang): { table: string; where: string; params: [Lang] } {
  return lang === BASE_LANG
    ? { table: `"pronunciation_lexicon"`, where: `${TEAM_ROWS} and $1::text is not null`, params: [lang] }
    : { table: `"pronunciation_lexicon_locale"`, where: `"lang" = $1`, params: [lang] };
}

/**
 * When a language's lexicon last changed, or null when it has no row: cheap enough to ask
 * on every line, so a caller can cache what it builds from the entries and rebuild only
 * when this moves.
 */
export async function lexiconStamp(lang: Lang = BASE_LANG): Promise<string | null> {
  const at = rowOf(lang);
  const rows = await readAs<{ updatedAt: Date }>(
    lang,
    `select "updatedAt" from ${at.table} where ${at.where}`,
    at.params,
  );
  return rows[0] ? rows[0].updatedAt.toISOString() : null;
}

async function readRow(lang: Lang = BASE_LANG): Promise<Row | undefined> {
  const at = rowOf(lang);
  const rows = await readAs<Row>(
    lang,
    // The comparison is made in Postgres, against the digest sync() stored, rather than by
    // comparing syncedAt with updatedAt out here. Both timestamps are now(), which is the
    // transaction's start time, and the save and the upload are two transactions
    // microseconds apart - so they can tie, and a refused re-upload then read as synced.
    // What is in force is in force because it was built from these rules, not because it
    // happened later. See migration 0019.
    `select "entries", "dictionaryId", "versionId", "rulesSent", "rulesKept",
            ("syncedDigest" is not null and "syncedDigest" = md5("entries"::text)) as "inForce",
            md5("entries"::text) as "digest", "syncedDigest",
            "syncedAt", "updatedAt", "updatedBy"
       from ${at.table} where ${at.where}`,
    at.params,
  );
  return rows[0];
}

export async function readLexicon(lang: Lang = BASE_LANG): Promise<EffectiveLexicon> {
  return effective(await readRow(lang), lang);
}

function effective(row: Row | undefined, lang: Lang): EffectiveLexicon {
  if (!row) {
    return {
      entries: [],
      // Another language starts with no entries at all, which is a lexicon nobody has
      // written yet rather than a failed seed; only English's missing row is the latter.
      seeded: lang !== BASE_LANG,
      sync: "never",
      locator: null,
      rulesSent: null,
      rulesKept: null,
      syncedAt: null,
      updatedAt: null,
      updatedBy: null,
      version: null,
    };
  }

  const locator = hasLocator(row) ? locatorOf(row) : null;

  return {
    entries: row.entries,
    seeded: true,
    // No locator at all is `never`, not `pending`: nothing is in force, so there is no older
    // dictionary for this save to be queued behind. With one, the question is whether it was
    // built from the entries this row now holds - which readRow asks of the stored digest.
    sync: !locator ? "never" : row.inForce ? "synced" : "pending",
    locator,
    rulesSent: row.rulesSent,
    rulesKept: row.rulesKept,
    syncedAt: row.syncedAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.digest,
  };
}

type AccountDictionary = DictionaryLocator & { syncedDigest: string };

function accountOf(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function readAccountDictionary(
  lang: Lang,
  account: string,
): Promise<AccountDictionary | undefined> {
  const rows = await query<AccountDictionary>(
    `select "dictionaryId", "versionId", "syncedDigest"
       from "lexicon_account_dictionary" where "lang" = $1 and "account" = $2`,
    [lang, account],
  );
  return rows[0];
}

async function saveAccountDictionary(
  lang: Lang,
  account: string,
  locator: DictionaryLocator,
  digest: string,
): Promise<void> {
  await query(
    `insert into "lexicon_account_dictionary"
       ("lang", "account", "dictionaryId", "versionId", "syncedDigest")
     values ($1, $2, $3, $4, $5)
     on conflict ("lang", "account") do update set
       "dictionaryId" = excluded."dictionaryId",
       "versionId"    = excluded."versionId",
       "syncedDigest" = excluded."syncedDigest"`,
    [lang, account, locator.dictionaryId, locator.versionId, digest],
  );
}

function pinnedDictionaryId(): string | undefined {
  return process.env.ELEVENLABS_DICTIONARY_ID?.trim() || undefined;
}

/**
 * The ids a save may update, best first. English's comes from the environment, because
 * ../wow-lore pins it too. Any of them may be on another collaborator's account.
 */
function knownIds(lang: Lang, mine?: string, rowId?: string | null): (string | null | undefined)[] {
  if (lang !== BASE_LANG) return [mine, rowId];
  const pinned = pinnedDictionaryId();
  return pinned ? [pinned, mine, rowId] : [];
}

/**
 * Only an unreadable id moves on. Any other failure is an outage or a refused key, and creating a
 * dictionary over one would leave the account with a second copy of the lexicon.
 */
async function uploadRules(
  ids: (string | null | undefined)[],
  rules: DictionaryRule[],
  options: ElevenLabsOptions,
  lang: Lang,
): Promise<{ locator: DictionaryLocator; kept: number | null }> {
  let locator: DictionaryLocator | undefined;
  for (const id of new Set(ids)) {
    if (!id) continue;
    try {
      locator = await updateDictionary(id, rules, options);
      break;
    } catch (error) {
      if (!(error instanceof DictionaryUnreadable)) throw error;
    }
  }
  locator ??= await createDictionary(rules, options, lang);

  // Read it back rather than trusting the 200. This is the check whose absence let 134 phoneme
  // rules upload as 2 and look like success. A failed readback leaves the count unknown, and the
  // dictionary may be perfectly good.
  const kept = await downloadPronunciationDictionary(locator, options)
    .then(countLexemes)
    .catch(() => null);
  return { locator, kept };
}

async function rulesFor(entries: LexiconEntry[], lang: Lang): Promise<DictionaryRule[]> {
  // One rule per spelling the language's own text uses, because a phoneme rule cannot be
  // case-insensitive.
  return toRules(
    entries,
    await graphemeCasings(entries.filter((e) => !e.alias).map((e) => e.grapheme), lang),
  );
}

async function canRead(dictionaryId: string, options: ElevenLabsOptions): Promise<boolean> {
  try {
    await readDictionary(dictionaryId, options);
    return true;
  } catch (error) {
    if (error instanceof DictionaryUnreadable) return false;
    throw error;
  }
}

async function bringAccountUpToDate(
  lang: Lang,
  account: string,
  row: UploadedRow,
  mine: AccountDictionary | undefined,
  options: ElevenLabsOptions,
): Promise<DictionaryLocator> {
  try {
    // Readable means the row's own account or a shared workspace. Uploading would only mint a
    // version identical to the one in force. Its digest stays the upload's, so a pending row
    // reads as older than its entries.
    if (!mine && (await canRead(row.dictionaryId, options))) {
      await saveAccountDictionary(lang, account, row, row.syncedDigest ?? "");
      return locatorOf(row);
    }

    const rules = await rulesFor(row.entries, lang);
    const { locator, kept } = await uploadRules(
      knownIds(lang, mine?.dictionaryId, row.dictionaryId),
      rules,
      options,
      lang,
    );
    if (kept !== null && kept < rules.length) {
      console.error(`${lang}: ElevenLabs kept only ${kept} of ${rules.length} rules in ${locator.dictionaryId}`);
    }
    await saveAccountDictionary(lang, account, locator, row.digest);
    return locator;
  } catch (error) {
    // An older version of the lexicon beats failing the line.
    if (mine) return locatorOf(mine);
    throw error;
  }
}

/** Lines run concurrently, and each would otherwise create the account's first dictionary. */
const bringing = new Map<string, Promise<DictionaryLocator>>();

/**
 * Null when the language has nothing in force, because refusing to generate over that would take
 * regeneration down the first time an upload failed.
 *
 * Throws when a lexicon is in force but this account cannot get it. Sending none would spend
 * credits on names said wrong, with nothing marking those takes for a redo.
 *
 * While the row is pending, every account keeps the version it has: the editor is saying the
 * newest save is not in effect yet.
 */
export async function dictionaryFor(
  lang: Lang,
  options: ElevenLabsOptions,
): Promise<DictionaryLocator | null> {
  const row = await readRow(lang);
  if (!row || !hasLocator(row) || !row.entries.length || !options.apiKey) return null;

  const account = accountOf(options.apiKey);
  const mine = await readAccountDictionary(lang, account);
  if (mine && (!row.inForce || mine.syncedDigest === row.digest)) {
    return locatorOf(mine);
  }

  const key = `${lang}:${account}`;
  const running = bringing.get(key);
  if (running) return running;

  const work = bringAccountUpToDate(lang, account, row, mine, options).finally(() =>
    bringing.delete(key),
  );
  bringing.set(key, work);
  return work;
}

/**
 * Store the entries, then try to upload them.
 *
 * In that order, and not in a transaction spanning the upload. A save that survives a failed
 * upload can be retried from the editor; an upload that survives a failed save would leave
 * ElevenLabs holding rules that no row describes, and generation would apply pronunciations
 * that nothing in this app can show anyone.
 */
export async function writeLexicon(
  entries: LexiconEntry[],
  updatedBy: string,
  options: ElevenLabsOptions = {},
  lang: Lang = BASE_LANG,
): Promise<{ lexicon: EffectiveLexicon; syncError: string | null }> {
  // Read before writing, because the diff is the only moment the previous rules exist: the
  // row holds one lexicon and the save overwrites it. What the diff is for is audio - a take
  // made before a word's rule moved no longer says what this lexicon would say - and
  // lexicon_change is the record nothing else in the schema keeps. See lib/generation/dirty.
  const before = (await readRow(lang))?.entries ?? [];

  await insertRow(
    lang,
    entries,
    updatedBy,
    `do update set
       "entries"   = excluded."entries",
       "updatedAt" = excluded."updatedAt",
       "updatedBy" = excluded."updatedBy"`,
  );

  return afterSave(before, entries, updatedBy, options, lang);
}

export const NO_KEY_TO_SYNC = "saved, but not uploaded: there is no ElevenLabs key to upload with";

/** A language's row, as its team; `onConflict` is what a row already there gets. */
function insertRow(lang: Lang, entries: LexiconEntry[], updatedBy: string, onConflict: string) {
  const json = JSON.stringify(entries);
  return queryAs(
    lang,
    lang === BASE_LANG
      ? `insert into "pronunciation_lexicon" ("entries", "updatedAt", "updatedBy")
         values ($1, now(), $2) on conflict ("teamId") ${onConflict}`
      : `insert into "pronunciation_lexicon_locale" ("lang", "entries", "updatedAt", "updatedBy")
         values ($3, $1, now(), $2) on conflict ("teamId", "lang") ${onConflict}`,
    lang === BASE_LANG ? [json, updatedBy] : [json, updatedBy, lang],
  );
}

async function afterSave(
  before: LexiconEntry[],
  entries: LexiconEntry[],
  updatedBy: string,
  options: ElevenLabsOptions,
  lang: Lang,
): Promise<{ lexicon: EffectiveLexicon; syncError: string | null }> {
  // Without a key the save stays pending, and the corpus scan rulesFor makes is skipped.
  const syncError = options.apiKey ? await sync(entries, options, lang) : NO_KEY_TO_SYNC;
  const lexicon = await readLexicon(lang);

  // After the sync, so the row can carry the version that shipped it - and unconditionally,
  // because a change whose upload failed still happened. A logging failure must not turn a
  // save the admin can see into a 500: the entries are in Postgres either way, and the worst
  // case is audio that goes on reading as clean until the next edit to the same word.
  try {
    await logSoundChanges(
      soundChanges(before, entries),
      updatedBy,
      lexicon.locator?.versionId ?? null,
      lang,
    );
  } catch (error) {
    console.error("lexicon saved but its changes were not logged", error);
  }

  return { lexicon, syncError };
}

/** `expectedVersion` did not match, or the lexicon kept changing under the edit. */
export class LexiconConflict extends Error {
  /** The version last read, for the caller to retry against. */
  constructor(
    message: string,
    readonly version: string | null,
  ) {
    super(message);
  }
}

/**
 * Store the entries only if the row still holds what `digest` says it read, null meaning no
 * row. False when someone saved in between.
 */
async function storeIf(
  lang: Lang,
  entries: LexiconEntry[],
  updatedBy: string,
  digest: string | null,
): Promise<boolean> {
  if (digest === null) {
    return (await insertRow(lang, entries, updatedBy, "do nothing")).rowCount === 1;
  }
  const at = rowOf(lang);
  const { rowCount } = await queryAs(
    lang,
    `update ${at.table} set "entries" = $2, "updatedAt" = now(), "updatedBy" = $3
      where ${at.where} and md5("entries"::text) = $4`,
    [lang, JSON.stringify(entries), updatedBy, digest],
  );
  return rowCount === 1;
}

const EDIT_ATTEMPTS = 3;

/**
 * Change part of a lexicon: `edit` gets the entries stored now and returns the new ones.
 *
 * The row is one JSON document, so two partial edits racing would each overwrite the other's.
 * The write is made against the digest it read and redone on a miss. With `expectedVersion`
 * there is no redo: the caller is saying what it based the edit on, and a miss is a 409.
 *
 * An edit that returns the entries it was given writes nothing and uploads nothing.
 */
export async function editLexicon<T>(
  lang: Lang,
  edit: (entries: LexiconEntry[]) => { entries: LexiconEntry[]; result: T },
  updatedBy: string,
  options: ElevenLabsOptions = {},
  expectedVersion?: string | null,
): Promise<{ lexicon: EffectiveLexicon; syncError: string | null; result: T }> {
  let digest: string | null = null;
  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
    const row = await readRow(lang);
    digest = row?.digest ?? null;
    if (expectedVersion !== undefined && digest !== expectedVersion) {
      throw new LexiconConflict("the lexicon changed since that version was read", digest);
    }
    const before = row?.entries ?? [];
    const { entries, result } = edit(before);
    if (entries === before) return { lexicon: effective(row, lang), syncError: null, result };
    if (await storeIf(lang, entries, updatedBy, digest)) {
      return { ...(await afterSave(before, entries, updatedBy, options, lang)), result };
    }
  }
  throw new LexiconConflict("the lexicon kept changing during this edit; send it again", digest);
}

/**
 * Bring the configured dictionary's rules to exactly `rules`, and return the version that is.
 *
 * Add first, remove second, and remove only what is genuinely gone. add-rules replaces any
 * rule matching the same string, so sending the whole lexicon makes every rule in it current
 * without anything having to work out which ones changed - and at no instant is a rule the
 * lexicon still holds missing from the dictionary. The reverse order would have one: a
 * window where a name that is still in the lexicon has no pronunciation.
 *
 * The intermediate version between the two calls is harmless whichever way round, because
 * versions are immutable and every request names one. Generation in flight is pinned to the
 * version it started with.
 */
async function updateDictionary(
  dictionaryId: string,
  rules: DictionaryRule[],
  options: ElevenLabsOptions,
): Promise<DictionaryLocator> {
  const stored = await readDictionary(dictionaryId, options);

  const wanted = new Set(rules.map((rule) => rule.string_to_replace));
  const gone = stored.ruleStrings.filter((string) => !wanted.has(string));

  // The latest version stands in for "nothing to do", which is the case where an admin saves
  // the lexicon back unchanged: neither call fires and the locator is what it already was.
  let versionId = stored.latestVersionId;
  if (rules.length) versionId = await addDictionaryRules(dictionaryId, rules, options);
  if (gone.length) versionId = await removeDictionaryRules(dictionaryId, gone, options);

  return { dictionaryId, versionId };
}

/**
 * The id is logged because it is the value to put in ELEVENLABS_DICTIONARY_ID and in
 * wow-lore's tools/voice/config.json. Without it configured, every save creates another
 * dictionary and no other project can name this one.
 */
async function createDictionary(
  rules: DictionaryRule[],
  options: ElevenLabsOptions,
  lang: Lang,
): Promise<DictionaryLocator> {
  // Dated, because without a configured id a save creates another of these, and the account
  // list would otherwise be a column of identical names with no way to tell which is live.
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (lang !== BASE_LANG) {
    // No environment variable per language: nothing outside this app names these dictionaries.
    return createPronunciationDictionary(`spoken ${lang} ${stamp}`, rules, options);
  }
  const name = `wow-voiceover ${stamp}`;
  const locator = await createPronunciationDictionary(name, rules, options);

  // With an id set, this is a collaborator's account that cannot read it, and is not a mistake.
  if (!pinnedDictionaryId()) {
    console.warn(
      `ELEVENLABS_DICTIONARY_ID is not set, so a new pronunciation dictionary was created: ` +
        `${locator.dictionaryId}. Set it to that id so later saves update it in place.`,
    );
  }
  return locator;
}

/**
 * Upload the entries and record where they landed. Returns null, or why it failed.
 *
 * The failure is returned rather than thrown because it is not the save failing: the entries
 * are already stored, the editor still has something true to show, and the only thing lost is
 * that the change is not yet in effect. A thrown error here would read to the caller as "your
 * edit was rejected", which would be wrong.
 */
export async function sync(
  entries: LexiconEntry[],
  options: ElevenLabsOptions = {},
  lang: Lang = BASE_LANG,
): Promise<string | null> {
  const rules = await rulesFor(entries, lang);
  const account = options.apiKey ? accountOf(options.apiKey) : null;
  const mine = account ? await readAccountDictionary(lang, account) : undefined;

  let uploaded;
  try {
    uploaded = await uploadRules(
      knownIds(lang, mine?.dictionaryId, (await readRow(lang))?.dictionaryId),
      rules,
      options,
      lang,
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const { locator, kept } = uploaded;

  // Conditional on the entries still being the ones that were uploaded. Two admins saving at
  // once would otherwise interleave as save(A), save(B), upload(A), upload(B) - and after
  // upload(A) landed last, the row would pair B's entries with A's rules and, because
  // syncedAt is then newer than updatedAt, report itself as synced. The editor would be
  // showing entries that nothing is being spoken with, which is the one lie this module is
  // built to avoid. jsonb equality ignores key order, so this compares content, not spelling.
  // "syncedDigest" is taken from the row's own column rather than hashed here, and the
  // where clause is what makes that exact: the statement only lands while "entries" is still
  // what was uploaded, so md5 of it is the digest of these rules and no others.
  const at = rowOf(lang);
  const { rowCount, rows } = await queryAs<{ syncedDigest: string }>(
    lang,
    `update ${at.table}
        set "dictionaryId" = $2, "versionId" = $3, "syncedAt" = now(),
            "syncedDigest" = md5("entries"::text),
            "rulesSent" = $5, "rulesKept" = $6
      where ${at.where} and "entries" = $4::jsonb
      returning "syncedDigest"`,
    [lang, locator.dictionaryId, locator.versionId, JSON.stringify(entries), rules.length, kept],
  );
  if (rowCount === 0) {
    return "the lexicon changed while this upload was in flight; the newer save is the one to retry";
  }
  if (account) await saveAccountDictionary(lang, account, locator, rows[0].syncedDigest);

  if (kept !== null && kept < rules.length) {
    return `ElevenLabs kept only ${kept} of ${rules.length} rules. The dictionary is in force, but incomplete.`;
  }
  return null;
}

/** Re-upload whatever is stored, for retrying a sync that failed after a successful save. */
export async function resync(
  options: ElevenLabsOptions = {},
  lang: Lang = BASE_LANG,
): Promise<string | null> {
  const row = await readRow(lang);
  if (!row) return "there is no saved lexicon to upload";
  return sync(row.entries, options, lang);
}
