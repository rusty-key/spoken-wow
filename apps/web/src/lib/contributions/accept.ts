/**
 * Resolving a contribution -- the route's whole verb, now that accepting a quests row can also
 * write a line.
 *
 * Everything except quests-accept and books-accept in another language is the plain status
 * flip setContributionStatus always did: a moderator moving any row to "new" or "rejected"
 * changes nothing else. Books-accept writes that language's page (acceptBookTranslation).
 * Quests-accept is different because the accepted line must appear in the explorer, and the
 * explorer reads the quest tables (lib/quests/catalogue.ts) -- so accepting writes into them:
 * a `quest_line` row with origin "contributed" and a `quest_line_speaker` row carrying the
 * contribution's id, in the same transaction as the status update. Re-accepting must not
 * duplicate, and a status flip with no line, or a line with no status flip, is a state nothing
 * else here is built to handle.
 *
 * The speaker row is what marks a line as contributed, not the line's origin: an editor's text
 * fix adds an "edited" version on top, and the line is still one a player sent. It is also what
 * the importer (tts_cli/corpus_db.py) leaves alone when it replaces every extracted speaker.
 *
 * The contributed text is what the player's client displayed, with that player's name, class
 * and race put back as `$N`, `$C` and `$R` by the addon -- the only side that knows which words
 * they were. So it is a template, like the extract's: stored as `originalText`, with `text` its
 * spoken form (tokens.ts). Anything else the client substituted -- the one branch of a `$G` it
 * picked -- stays as displayed; an editor has the text-override flow for that.
 */
import { skipReasonFor } from "@/lib/text-gate";
import type { PoolClient } from "pg";

import { normaliseText } from "@books-tools/lib/text.mjs";

import { recordActivity } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { observedFrom } from "@/lib/npc/resolve";
import {
  getResolution,
  getResolutions,
  getResolutionsById,
  resolutionKey,
  type NpcKind,
  type NpcResolution,
} from "@/lib/npc/store";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import type { CorpusLine } from "@/lib/corpus";
import { isGeneratable } from "@/lib/books/tools";
import { speakPlayerTokens } from "@/lib/player-words";
import { corpus } from "@/lib/quests/catalogue";
import { isVoice } from "@/lib/voices/voices";

import type { ContributionStatus } from "./contributions";
import {
  answersQuestMoment,
  answersQuestMomentSql,
  lineIdentityFor,
  voiceNameFor,
  type LineIdentity,
} from "./naming";
import { CONTRIBUTION_COLUMNS, observationMeta, type Contribution } from "./store";
import { spokenFromTemplate } from "./tokens";
import { idOnlyResolution } from "./triage";

const COLUMNS = CONTRIBUTION_COLUMNS;

/**
 * Where contributed speakers start in quest_line_speaker's `ord`. The importer numbers the
 * extract's own rows from 0 on every import, so contributed rows sit far above it: they never
 * collide with a re-import, and the export lists them after everything the extract carries.
 */
const CONTRIBUTED_ORD_FLOOR = 1_000_000;

export type ResolveRefusal =
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "needs-speaker"; message: string }
  | { ok: false; reason: "needs-page"; message: string }
  | { ok: false; reason: "one-way"; message: string }
  | { ok: false; reason: "malformed"; message: string };

export type ResolveOutcome = { ok: true; contribution: Contribution } | ResolveRefusal;

type Speaker = {
  npcId: number;
  npcName: string | null;
  npcType: NpcKind;
  race: string;
  gender: string;
  flavor: string | null;
};

/** What accept writes: a new line and its speaker, or only a speaker on a line already there. */
type Prepared =
  | { kind: "exists" }
  | { kind: "speaker"; lineId: string; variant: number; speaker: Speaker }
  | { kind: "line"; identity: LineIdentity; text: string; speaker: Speaker };

/**
 * The npc_resolution rows for many contributions' NPCs, read up front in two queries -- what
 * linesInExplorer hands resolvedSpeaker so a page of rows is not a round trip per row.
 */
type Resolutions = {
  byKey: Map<string, NpcResolution>;
  byId: Map<number, NpcResolution[]>;
};

async function resolutionsFor(contributions: readonly Contribution[]): Promise<Resolutions> {
  const keys: { npcKind: NpcKind; npcId: number }[] = [];
  const ids: number[] = [];
  for (const contribution of contributions) {
    const observed = observedFrom(observationMeta(contribution));
    if (observed.npcId === null) continue;
    if (observed.npcKind) keys.push({ npcKind: observed.npcKind, npcId: observed.npcId });
    else ids.push(observed.npcId);
  }
  const [byKey, byId] = await Promise.all([getResolutions(keys), getResolutionsById([...new Set(ids)])]);
  return { byKey, byId };
}

/** Who speaks a quests contribution, from npc_resolution -- the same lookup triage.ts's page renders from. */
async function resolvedSpeaker(
  meta: Record<string, string>,
  resolutions?: Resolutions,
): Promise<Speaker | "conflict" | null> {
  const observed = observedFrom(meta);
  if (observed.npcId === null) return null;

  let resolution;
  if (observed.npcKind) {
    resolution = resolutions
      ? resolutions.byKey.get(resolutionKey(observed.npcKind, observed.npcId))
      : await getResolution(observed.npcKind, observed.npcId);
  } else {
    const rows = resolutions
      ? resolutions.byId.get(observed.npcId)
      : (await getResolutionsById([observed.npcId])).get(observed.npcId);
    const lookup = idOnlyResolution(rows);
    if (lookup.conflict.length) return "conflict";
    resolution = lookup.resolution;
  }

  if (!resolution?.race || !resolution?.gender) return null;

  return {
    npcId: observed.npcId,
    npcName: resolution.npcName ?? observed.npcName,
    npcType: resolution.npcKind,
    race: resolution.race,
    gender: resolution.gender,
    flavor: resolution.flavor,
  };
}

/**
 * The catalogue, indexed for the questions prepareLine and acceptTranslation ask of it -- a
 * linear scan per row was most of what a page of accepted rows, or a batch accept, cost.
 *
 * `byPrefix` holds each line under its own id and under every shorter `:`-joined prefix of it,
 * which is exactly answersQuestMoment: `q:1:accept` finds `q:1:accept` and `q:1:accept:m`.
 * `gossipByText` is the by-text match below, keyed on race, gender and normalised text. Both
 * keep the catalogue's order, so a first match is the same line a scan would have found.
 *
 * Kept per catalogue array, which is replaced whenever the tables move (catalogue.ts).
 */
type CorpusIndex = {
  byPrefix: Map<string, CorpusLine[]>;
  gossipByText: Map<string, CorpusLine[]>;
  /** A line's place in the catalogue, for "whichever comes first". */
  position: Map<CorpusLine, number>;
};

const corpusIndexes = new WeakMap<readonly CorpusLine[], CorpusIndex>();

function pushTo<K>(map: Map<K, CorpusLine[]>, key: K, line: CorpusLine): void {
  const group = map.get(key);
  if (group) group.push(line);
  else map.set(key, [line]);
}

function gossipTextKey(race: string, gender: string, text: string): string {
  return `${race}|${gender}|${text}`;
}

function indexOf(lines: readonly CorpusLine[]): CorpusIndex {
  let index = corpusIndexes.get(lines);
  if (index) return index;
  index = { byPrefix: new Map(), gossipByText: new Map(), position: new Map() };
  for (const [position, line] of lines.entries()) {
    index.position.set(line, position);
    const parts = line.lineId.split(":");
    for (let end = parts.length; end >= 2; end--) pushTo(index.byPrefix, parts.slice(0, end).join(":"), line);
    if (parts.length < 2) pushTo(index.byPrefix, line.lineId, line);
    if (line.source === "gossip") {
      pushTo(index.gossipByText, gossipTextKey(line.race, line.gender, normaliseText(line.originalText)), line);
    }
  }
  corpusIndexes.set(lines, index);
  return index;
}

/** The lines answering a quest moment, in catalogue order: answersQuestMoment, from the index. */
function answering(lines: readonly CorpusLine[], momentId: string): CorpusLine[] {
  return (indexOf(lines).byPrefix.get(momentId) ?? []).filter((line) => answersQuestMoment(line.lineId, momentId));
}

async function speakerFor(
  contribution: Contribution,
  resolutions?: Resolutions,
): Promise<{ ok: true; speaker: Speaker } | ResolveRefusal> {
  const speaker = await resolvedSpeaker(observationMeta(contribution), resolutions);
  if (speaker === "conflict") {
    return {
      ok: false,
      reason: "needs-speaker",
      message: "This NPC's id has conflicting answers -- pick which one it is first.",
    };
  }
  if (!speaker) {
    return {
      ok: false,
      reason: "needs-speaker",
      message: "Set the speaker first -- a line needs a voice.",
    };
  }
  // The roster is what /voices, the filters and the triage selects offer, so a line in a voice
  // outside it -- a client guess naming a race nobody has added -- would be unvoiceable and
  // unfindable. Adding the voice to voices.ts is the fix, not accepting the line anyway.
  const voice = voiceNameFor(speaker.race, speaker.gender, speaker.flavor);
  if (!isVoice(voice)) {
    return {
      ok: false,
      reason: "needs-speaker",
      message: `${voice} isn't a voice yet -- pick another speaker, or add it to voices.ts.`,
    };
  }
  return { ok: true, speaker };
}

/**
 * What accepting a quests contribution writes, or a refusal.
 *
 * The tables are the corpus, so "is this line already there" is asked of them:
 *
 *   - A quest line is matched by quest id and moment alone (answersQuestMoment): the tables
 *     carry some moments only as `:m`/`:f` player-gender variants, and a contribution names a
 *     moment and nothing finer. Already there means nothing is written -- the corpus wins, and
 *     a second contribution for the same moment is the same line.
 *   - A gossip line is one text spoken by many NPCs. Already there (by id, or by text once the
 *     corpus's own trailing whitespace is normalised away) means this NPC is added as one more
 *     speaker of it, unless they already are one.
 */
async function prepareLine(
  contribution: Contribution,
  corpusLines?: readonly CorpusLine[],
  resolutions?: Resolutions,
): Promise<{ ok: true; prepared: Prepared } | ResolveRefusal> {
  const found = await speakerFor(contribution, resolutions);
  if (!found.ok) return found;
  const { speaker } = found;

  const { quest, event } = contribution.meta;
  const isGossip = !(quest && event);

  const identity = lineIdentityFor(contribution.meta, contribution.text, speaker.race, speaker.gender);
  if (!identity) {
    return {
      ok: false,
      reason: "malformed",
      message: isGossip ? "gossip contribution has no text to hash" : `unknown quest event "${event}"`,
    };
  }
  if (!contribution.text) {
    return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  }

  const lines = corpusLines ?? (await corpus()).lines;

  if (!isGossip) {
    const exists = answering(lines, identity.lineId).length > 0;
    return { ok: true, prepared: exists ? { kind: "exists" } : { kind: "line", identity, text: contribution.text, speaker } };
  }

  // By id, or by text: 1,644 of the corpus's gossip lines carry trailing whitespace in
  // `originalText` that normaliseText (already applied to contribution.text at intake,
  // submission.ts) strips, so a verbatim duplicate of one of them hashes differently.
  // Whichever of the two comes first in the catalogue, as a scan for either would find.
  const text = contribution.text;
  const index = indexOf(lines);
  const byId = (index.byPrefix.get(identity.lineId) ?? []).find(
    (l) => l.source === "gossip" && l.lineId === identity.lineId,
  );
  const byText = index.gossipByText.get(gossipTextKey(speaker.race, speaker.gender, text))?.[0];
  const match =
    byId && byText ? (index.position.get(byId)! <= index.position.get(byText)! ? byId : byText) : (byId ?? byText);
  if (!match) return { ok: true, prepared: { kind: "line", identity, text, speaker } };

  const speaks = (index.byPrefix.get(match.lineId) ?? []).some(
    (l) => l.lineId === match.lineId && l.npcType === speaker.npcType && l.npcId === speaker.npcId,
  );
  if (speaks) return { ok: true, prepared: { kind: "exists" } };
  return { ok: true, prepared: { kind: "speaker", lineId: match.lineId, variant: 0, speaker } };
}

/** Whether a contribution already has a speaker row in the quest tables -- i.e. has been written. */
export async function contributedSpeakerExists(contributionId: number, client?: PoolClient): Promise<boolean> {
  const { rowCount } = await (client ?? db()).query(
    `select 1 from "quest_line_speaker" where "contributionId" = $1`,
    [contributionId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Whether an accepted quests contribution's line is already in the explorer, one way or
 * another: its own speaker row was written, or the tables already had the line (and, for
 * gossip, this NPC speaking it) before it was accepted. What decides whether "Add to explorer"
 * still belongs on a row -- answered the same way accept itself would, so pressing the button
 * is never a silent no-op. A row whose speaker is unresolved answers false: pressing it lands on
 * "Set the speaker first".
 */
export async function lineIsInExplorer(contribution: Contribution): Promise<boolean> {
  return (await linesInExplorer([contribution])).has(contribution.id);
}

/**
 * lineIsInExplorer for many contributions at once, answered as the ids whose line is there:
 * one query for the speaker rows already written, two for the NPCs, and the catalogue read
 * once -- what the moderator page asks of every accepted row it shows.
 */
export async function linesInExplorer(contributions: readonly Contribution[]): Promise<Set<number>> {
  const books = await booksInExplorer(contributions);
  const candidates = contributions.filter((c) => c.source === "quests" && c.status === "accepted");
  if (candidates.length === 0) return books;
  const quests = await questsInExplorer(candidates);
  return new Set([...books, ...quests]);
}

/**
 * The books side of linesInExplorer: an accepted row from another language is there once the
 * language has its page -- written by this row, or by anything before it, which accept would
 * leave alone. An English row writes nothing, so it is never "missing" from the explorer.
 */
async function booksInExplorer(contributions: readonly Contribution[]): Promise<Set<number>> {
  const accepted = contributions.filter((c) => c.source === "books" && c.status === "accepted");
  const found = new Set(accepted.filter((c) => c.locale === BASE_LANG).map((c) => c.id));
  const matched = accepted.filter((c) => c.locale !== BASE_LANG && c.pageId !== null);
  if (matched.length === 0) return found;
  const { rows } = await db().query<{ id: number }>(
    `select m."id" from unnest($1::int[], $2::int[], $3::text[]) as m ("id", "pageId", "lang")
      where exists (select 1 from "book_line" b where b."pageId" = m."pageId" and b."lang" = m."lang")`,
    [matched.map((c) => c.id), matched.map((c) => c.pageId), matched.map((c) => c.locale)],
  );
  for (const row of rows) found.add(row.id);
  return found;
}

async function questsInExplorer(candidates: readonly Contribution[]): Promise<Set<number>> {

  const { rows } = await db().query<{ contributionId: number }>(
    `select distinct "contributionId" from "quest_line_speaker" where "contributionId" = any($1::int[])`,
    [candidates.map((c) => c.id)],
  );
  const found = new Set(rows.map((row) => row.contributionId));

  const unwritten = candidates.filter((c) => !found.has(c.id));
  const rest = unwritten.filter((c) => c.locale === BASE_LANG);
  const [translated, resolutions, lines] = await Promise.all([
    translationsInExplorer(unwritten.filter((c) => c.locale !== BASE_LANG)),
    rest.length ? resolutionsFor(rest) : undefined,
    rest.length ? corpus().then((c) => c.lines) : [],
  ]);
  for (const id of translated) found.add(id);
  for (const contribution of rest) {
    const result = await prepareLine(contribution, lines, resolutions);
    if (result.ok && result.prepared.kind === "exists") found.add(contribution.id);
  }
  return found;
}

/** A row from another language is in the explorer once that language has the moment, whoever wrote it. */
async function translationsInExplorer(contributions: readonly Contribution[]): Promise<number[]> {
  const moments = contributions.flatMap((c) => {
    if (!(c.meta.quest && c.meta.event)) return [];
    const identity = lineIdentityFor(c.meta, c.text ?? "", "", "");
    return identity ? [{ id: c.id, lineId: identity.lineId, lang: c.locale }] : [];
  });
  if (moments.length === 0) return [];
  const { rows } = await db().query<{ id: number }>(
    `select m."id" from unnest($1::int[], $2::text[], $3::text[]) as m ("id", "lineId", "lang")
      where exists (select 1 from "quest_line" q
                     where q."lang" = m."lang" and q."isCurrent"
                       and ${answersQuestMomentSql(`q."lineId"`, `m."lineId"`)})`,
    [moments.map((m) => m.id), moments.map((m) => m.lineId), moments.map((m) => m.lang)],
  );
  return rows.map((row) => row.id);
}

async function insertSpeaker(
  client: PoolClient,
  contributionId: number,
  lineId: string,
  variant: number,
  speaker: Speaker,
  lang: Lang = BASE_LANG,
): Promise<void> {
  // One writer at a time past this point, so two accepts can never pick the same `ord`.
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
  await client.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
        "flavor", "voice", "contributionId")
     select $1, $2, $3,
            greatest(coalesce(max("ord") + 1, 0), $4),
            $5, $6, $7, $8, $9, $10, $11, $12
       from "quest_line_speaker" where "lang" = $3`,
    [
      lineId, variant, lang, CONTRIBUTED_ORD_FLOOR, speaker.npcType, speaker.npcId,
      speaker.npcName ?? `npc ${speaker.npcId}`, speaker.race, speaker.gender, speaker.flavor,
      voiceNameFor(speaker.race, speaker.gender, speaker.flavor), contributionId,
    ],
  );
}

/**
 * One writer per line id past this point, so two accepts of the same line running side by side
 * (resolveContributions) can never both find it missing and both write it.
 */
async function lockLine(client: PoolClient, lineId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line:' || $1))`, [lineId]);
}

/**
 * insertSpeaker, unless this NPC already speaks the line. Asked of the table rather than the
 * catalogue: in a batch the catalogue is read once, before any of it is written, so a speaker
 * another row of the same batch just added is only in the table.
 */
async function addSpeakerOnce(
  client: PoolClient,
  contributionId: number,
  lineId: string,
  variant: number,
  speaker: Speaker,
): Promise<void> {
  const { rowCount } = await client.query(
    `select 1 from "quest_line_speaker"
      where "lang" = $1 and "lineId" = $2 and "npcType" = $3 and "npcId" = $4`,
    [BASE_LANG, lineId, speaker.npcType, speaker.npcId],
  );
  if (!rowCount) await insertSpeaker(client, contributionId, lineId, variant, speaker);
}

/**
 * In another language the line is that language's own: its text keeps $N, $C and $R as a
 * translation's does, and is what that client showed, so it is `localeText` too.
 */
async function insertLine(
  client: PoolClient,
  contributionId: number,
  userId: string,
  identity: LineIdentity,
  template: string,
  lang: Lang = BASE_LANG,
): Promise<void> {
  const english = lang === BASE_LANG;
  // A progress line is kept but never voiced, as the extract marks its own (skipReason
  // "progress"): the game plays no audio for that panel.
  const skipReason = english
    ? identity.source === "progress" ? "progress" : null
    : skipReasonFor(identity.source, template, lang, null);
  await client.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
        "generatable", "skipReason", "editedBy", "note")
     values ($1, 0, $2, 1, true, 'contributed', $3, $4, $5, null, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      identity.lineId, lang, identity.source, identity.questId, identity.questTitle,
      identity.fileName, english ? spokenFromTemplate(template) : template, template,
      english ? null : template, skipReason === null, skipReason,
      userId, `contribution #${contributionId}`,
    ],
  );
}

/** Whether the language has any row for a quest moment, current or not. */
async function momentTaken(client: PoolClient, lang: Lang, momentId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `select 1 from "quest_line" where "lang" = $1 and ${answersQuestMomentSql(`"lineId"`, "$2")}`,
    [lang, momentId],
  );
  return (rowCount ?? 0) > 0;
}

/** A contributed line and who speaks it, as its first version in `lang`. */
async function writeLine(
  client: PoolClient,
  contributionId: number,
  userId: string,
  identity: LineIdentity,
  template: string,
  speaker: Speaker,
  lang: Lang,
): Promise<void> {
  await insertLine(client, contributionId, userId, identity, template, lang);
  await insertSpeaker(client, contributionId, identity.lineId, 0, speaker, lang);
}

/**
 * A contribution sent from a pack in another language: that language's version of a quest line,
 * or, when English does not have the moment, a line of that language's own.
 *
 * Only a quest line can be matched. Its id is the quest and the moment, the same in every
 * language; a gossip line's id is a hash of its English text, which a Portuguese client never
 * shows, so there is nothing to match it to.
 *
 * The text keeps its $N, $C and $R. The English accept writes "adventurer" in their place,
 * which in another language is an English word, so here they stay in, as the dump's own
 * translations keep theirs, and the language's own word is put in when the line is voiced
 * (player-words.ts).
 * A line this language already has is left alone: an import or a translator got there first.
 * The quest's and the NPC's names the client showed are written the same way (namesSeenIn).
 */
async function acceptTranslation(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
  corpusLines?: readonly CorpusLine[],
): Promise<ResolveRefusal | null> {
  const { quest, event } = contribution.meta;
  if (!(quest && event)) {
    return {
      ok: false,
      reason: "malformed",
      message: "A greeting in another language cannot be matched to the English line it translates.",
    };
  }
  const identity = lineIdentityFor(contribution.meta, contribution.text ?? "", "", "");
  if (!identity || !contribution.text) {
    return { ok: false, reason: "malformed", message: `unknown quest event "${event}"` };
  }

  const text = contribution.text;
  const lang = contribution.locale as Lang;

  const cached = answering(corpusLines ?? (await corpus()).lines, identity.lineId);
  const english = cached.length ? cached : await englishMoment(client, identity.lineId);
  if (english.length === 0) {
    const refused = await acceptNativeLine(client, contribution, userId, identity, text);
    if (refused) return refused;
  }

  const seen = new Set<string>();
  for (const line of english) {
    // Variant 0 only: a language keeps one text per line id, whichever content patch the
    // English variants come from (tts_cli/locale_import.py says why).
    if (line.variant) continue;
    if (seen.has(line.lineId)) continue;
    seen.add(line.lineId);
    // Per line id: its $N is spoken in the form the line's player gender takes.
    const skipReason = skipReasonFor(
      identity.source, text, lang, line.playerGender,
    );
    await client.query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
          "generatable", "skipReason", "editedBy", "note")
       select e."lineId", e."variant", $3, 1, true, 'contributed', e."source", e."questId",
              null, e."playerGender", e."fileName", $4, e."originalText", $4, $5, $6, $7, $8
         from "quest_line" e
        where e."lineId" = $1 and e."variant" = $2 and e."lang" = $9 and e."isCurrent"
          and not exists (select 1 from "quest_line" t
                           where t."lineId" = $1 and t."variant" = $2 and t."lang" = $3)`,
      [
        line.lineId, 0, contribution.locale, text, skipReason === null,
        skipReason, userId, `contribution #${contribution.id}`, BASE_LANG,
      ],
    );
  }
  for (const name of namesSeenIn(contribution)) {
    await nameIfUnnamed(client, { ...name, lang, userId, note: noteFor(contribution.id) });
  }
  return null;
}

/**
 * The English lines answering a moment the catalogue did not have, from the table and under
 * the line's lock: a batch reads the catalogue once, before any of it is written, and English
 * may have landed since.
 */
async function englishMoment(
  client: PoolClient,
  momentId: string,
): Promise<Pick<CorpusLine, "lineId" | "variant" | "playerGender">[]> {
  await lockLine(client, momentId);
  const { rows } = await client.query<Pick<CorpusLine, "lineId" | "variant" | "playerGender">>(
    `select "lineId", "variant", "playerGender" from "quest_line"
      where "lang" = $1 and "isCurrent" and ${answersQuestMomentSql(`"lineId"`, "$2")}
      order by "lineId", "variant"`,
    [BASE_LANG, momentId],
  );
  return rows;
}

/**
 * The id and file are the quest's and the event's, the same in every language, so when English
 * sends the moment later it is the same line and the same file. The caller holds the line's
 * lock; a moment this language already has is left alone.
 */
async function acceptNativeLine(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
  identity: LineIdentity,
  text: string,
): Promise<ResolveRefusal | null> {
  const lang = contribution.locale as Lang;
  if (await momentTaken(client, lang, identity.lineId)) return null;
  const found = await speakerFor(contribution);
  if (!found.ok) return found;
  await writeLine(client, contribution.id, userId, identity, text, found.speaker, lang);
  return null;
}

/** Longer than any name the game gives a quest or an NPC; what npc-identity caps a typed one at. */
const MAX_NAME = 200;

/**
 * The names a translated quests contribution shows in its own language: the quest's title and
 * the NPC's name, as the client displayed them. Without them the translated explorer shows a
 * line in the language under the English names of its quest and speaker -- the catalogue reads
 * names from entity_name alone, and only an import wrote them there, so an NPC newer than the
 * last dump stayed English however many of its lines were accepted.
 *
 * The NPC is the envelope's own `npc`, never the moderator's answer (setContributionNpc): that
 * answer names who it is, typed by someone reading the English site, not what this client
 * called them. And only with the envelope's `kind`: a creature and a gameobject can share an
 * id, and a kind-less envelope does not say which (observedFrom).
 */
export function namesSeenIn(
  contribution: Pick<Contribution, "source" | "meta">,
): { kind: "quest" | NpcKind; entityId: string; name: string }[] {
  if (contribution.source !== "quests") return [];
  const names: { kind: "quest" | NpcKind; entityId: string; name: string }[] = [];
  const { quest, title } = contribution.meta;
  if (quest && /^\d+$/.test(quest) && title?.trim() && title.trim().length <= MAX_NAME) {
    names.push({ kind: "quest", entityId: quest, name: title.trim() });
  }
  const observed = observedFrom(contribution.meta);
  if (observed.npcKind && observed.npcId !== null && observed.npcName && observed.npcName.length <= MAX_NAME) {
    names.push({ kind: observed.npcKind, entityId: String(observed.npcId), name: observed.npcName });
  }
  return names;
}

/**
 * A name a moderator accepted, written only where the language has none. As 'contributed',
 * not 'edited', so the next import that finds the game's own name promotes over it (migration
 * 0060); and never over a name already there, whether an import's or a translator's.
 * Conflict-free rather than locked: two rows of a batch may name the same thing, and whichever
 * lands first is the one kept.
 */
async function nameIfUnnamed(
  client: PoolClient,
  args: { kind: string; entityId: string; lang: Lang; name: string; userId: string | null; note: string },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `insert into "entity_name"
       ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "editedBy", "note")
     select $1, $2, $3,
            (select coalesce(max("version"), 0) + 1 from "entity_name"
              where "kind" = $1 and "entityId" = $2 and "lang" = $3),
            true, 'contributed', $4, $5, $6
      where not exists (select 1 from "entity_name"
                         where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent")
     on conflict do nothing`,
    [args.kind, args.entityId, args.lang, args.name, args.userId, args.note],
  );
  return (rowCount ?? 0) > 0;
}

/** The note a written row carries, which is also how it is found again. */
export function noteFor(contributionId: number): string {
  return `contribution #${contributionId}`;
}

/** Whether a books contribution has written a page -- the books side of contributedSpeakerExists. */
async function contributedPageExists(contributionId: number, client: PoolClient): Promise<boolean> {
  const { rowCount } = await client.query(
    `select 1 from "book_line" where "origin" = 'contributed' and "note" = $1`,
    [noteFor(contributionId)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * A books contribution sent from a client in another language: that language's text of a
 * page the English corpus has, written as its first version.
 *
 * Which page is the moderator's answer, on the contribution (migration 0059): the envelope
 * carries only the checksum of the translated text, which names no page by itself. A row
 * nobody has matched is refused rather than guessed at -- a title and a page number do not
 * identify a page (AGENTS.md), and a translation filed under the wrong page is read aloud
 * over the wrong one.
 *
 * Structure comes from the English page, as saveBookText takes it for a first translation;
 * the title is the one the client showed. A page this language already has is left alone,
 * as acceptTranslation leaves a quest line: an import or a translator got there first. The
 * owner's name in this language is written the same way, only where it has none, since the
 * catalogue titles a translated page from entity_name rather than from the row. It is written
 * as 'contributed', not 'edited', so the next import that finds the game's own name promotes
 * it over this one (migration 0060).
 */
async function acceptBookTranslation(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
): Promise<ResolveRefusal | null> {
  const text = contribution.text?.trim();
  if (!text) return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  if (contribution.pageId === null) {
    return {
      ok: false,
      reason: "needs-page",
      message: "Match it to an English page first -- the text alone does not say which page it is.",
    };
  }

  const lang = contribution.locale as Lang;
  const title = contribution.meta.book?.trim() || null;
  const { generatable, skipReason } = isGeneratable(speakPlayerTokens(text, lang));
  const note = noteFor(contribution.id);
  // Conflict-free rather than locked: two rows of a batch may write the same page, or name the
  // same owner, and whichever lands first is the one kept.
  const { rows: english } = await client.query<{ ownerKind: string; ownerIds: number[] }>(
    `select "ownerKind", "ownerIds" from "book_line"
      where "pageId" = $1 and "lang" = $2 and "isCurrent"`,
    [contribution.pageId, BASE_LANG],
  );
  if (english.length === 0) {
    return { ok: false, reason: "needs-page", message: `There is no English page ${contribution.pageId} -- match it again.` };
  }
  const { rows: written } = await client.query<{ ownerKind: string; ownerIds: number[] }>(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
        "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
        "text", "generatable", "skipReason", "editedBy", "note")
     select e."lineId", $2, 1, true, 'contributed', e."pageId", e."bookId",
            e."pageNumber", e."pageCount", coalesce($3, e."title"), e."ownerKind",
            e."ownerIds", e."material", $4, $5, $6, $7, $8
       from "book_line" e
      where e."pageId" = $1 and e."lang" = $9 and e."isCurrent"
        and not exists (select 1 from "book_line" t
                         where t."lineId" = e."lineId" and t."lang" = $2)
     on conflict do nothing
     returning "ownerKind", "ownerIds"`,
    [contribution.pageId, lang, title, text, generatable, skipReason, userId, note, BASE_LANG],
  );
  if (!title) return null;
  for (const { ownerKind, ownerIds } of written) {
    for (const owner of ownerIds) {
      await nameIfUnnamed(client, {
        kind: ownerKind === "object" ? "gameobject" : "item",
        entityId: String(owner),
        lang,
        name: title,
        userId,
        note,
      });
    }
  }
  return null;
}

/**
 * Change a contribution's status, writing its line into the quest tables first when the target
 * is "accepted" for a fresh quests row.
 *
 * `corpusLines` is the English catalogue to match against, read by the caller -- a batch reads
 * it once for all its rows. Left out, it is read here.
 */
export async function resolveContribution(
  id: number,
  status: ContributionStatus,
  userId: string,
  corpusLines?: readonly CorpusLine[],
): Promise<ResolveOutcome> {
  const client = await db().connect();
  // Set only on the path below where rollback itself throws -- that is the one case that
  // releases the client itself (with the error, so node-postgres destroys rather than recycles
  // a connection left in an unknown state) instead of leaving it to the normal `finally`.
  let released = false;
  try {
    await client.query("begin");

    const { rows } = await client.query<Contribution>(
      `select ${COLUMNS} from "contribution" where "id" = $1 for update`,
      [id],
    );
    const contribution = rows[0];
    if (!contribution) {
      await client.query("rollback");
      return { ok: false, reason: "not-found" };
    }
    // Intake stores only the site's languages; a row from before it did must not write text
    // under a language no page shows.
    if (status === "accepted" && !isLang(contribution.locale)) {
      await client.query("rollback");
      return {
        ok: false,
        reason: "malformed",
        message: `sent from a ${contribution.locale} client, which is not a language here`,
      };
    }

    const written =
      contribution.source === "books"
        ? await contributedPageExists(id, client)
        : await contributedSpeakerExists(id, client);

    // One-way once written. Audio may already have been generated for the line, and the
    // explorer's own line-ignore is how an editor backs out of a line they no longer want.
    if (written && status !== "accepted") {
      await client.query("rollback");
      return {
        ok: false,
        reason: "one-way",
        message: "This line is already in the explorer; ignore it there instead.",
      };
    }

    if (
      status === "accepted" &&
      contribution.source === "books" &&
      contribution.locale !== BASE_LANG
    ) {
      const refused = await acceptBookTranslation(client, contribution, userId);
      if (refused) {
        await client.query("rollback");
        return refused;
      }
    } else if (
      status === "accepted" &&
      contribution.source === "quests" &&
      contribution.locale !== BASE_LANG
    ) {
      const refused = await acceptTranslation(client, contribution, userId, corpusLines);
      if (refused) {
        await client.query("rollback");
        return refused;
      }
    } else if (status === "accepted" && contribution.source === "quests" && !written) {
      const result = await prepareLine(contribution, corpusLines);
      if (!result.ok) {
        await client.query("rollback");
        return result;
      }
      const { prepared } = result;
      if (prepared.kind === "line") {
        // Checked again inside the transaction, under the line's lock: a concurrent accept of
        // another contribution for the same line may have written it since prepareLine read
        // the catalogue. Whichever lands first wins; a quest line is then only accepted, and a
        // gossip line gets this NPC as one more speaker, as prepareLine would have said had it
        // seen the line.
        await lockLine(client, prepared.identity.lineId);
        if (!(await momentTaken(client, BASE_LANG, prepared.identity.lineId))) {
          await writeLine(client, id, userId, prepared.identity, prepared.text, prepared.speaker, BASE_LANG);
        } else if (prepared.identity.source === "gossip") {
          await addSpeakerOnce(client, id, prepared.identity.lineId, 0, prepared.speaker);
        }
      } else if (prepared.kind === "speaker") {
        await lockLine(client, prepared.lineId);
        await addSpeakerOnce(client, id, prepared.lineId, prepared.variant, prepared.speaker);
      }
    }

    const updated = await client.query<Contribution>(
      `update "contribution"
          set "status" = $2, "resolvedBy" = $3, "updatedAt" = now()
        where "id" = $1
        returning ${COLUMNS}`,
      [id, status, userId],
    );
    // In the transaction, so a resolve that rolls back is never logged. A row sent from a
    // client in a language the site does not have is logged under every language rather
    // than dropped: somebody still resolved it.
    await recordActivity(
      {
        kind: "contribution.resolved",
        lang: isLang(contribution.locale) ? contribution.locale : null,
        source: contribution.source,
        subject: String(id),
        actorId: userId,
        detail: { status, key: contribution.key },
      },
      client,
    );

    await client.query("commit");
    return { ok: true, contribution: updated.rows[0] };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      // The rollback itself failed, so the client's state is unknown and must not go back to
      // the pool for reuse -- release(err) is what tells node-postgres to destroy it instead
      // of recycling it. Rethrowing `error`, not `rollbackError`: the caller's diagnosis
      // belongs to whatever actually went wrong, not to the rollback's own failure to undo it.
      released = true;
      client.release(rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
      throw error;
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}

/** How many rows of a batch resolve at once -- well inside the pool (db.ts's POOL_MAX). */
const BATCH_CONCURRENCY = 8;

/**
 * resolveContribution for many rows, side by side, reading the catalogue once for all of them.
 *
 * Reading it per row is what made a bulk accept crawl: every line written moves the
 * catalogue's stamp, so the next row rebuilt the whole of it. Rows of one batch can share a
 * line; lockLine and the re-checks under it are what keep them from both writing it.
 *
 * Each row is still its own transaction, so one refused (or failing) row leaves the rest
 * landed. A row that throws is answered as an Error, in its place.
 */
export async function resolveContributions(
  ids: readonly number[],
  status: ContributionStatus,
  userId: string,
): Promise<Map<number, ResolveOutcome | Error>> {
  const corpusLines = status === "accepted" ? (await corpus()).lines : undefined;
  const outcomes = new Map<number, ResolveOutcome | Error>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        outcomes.set(id, await resolveContribution(id, status, userId, corpusLines));
      } catch (error) {
        outcomes.set(id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, ids.length) }, worker));
  return outcomes;
}
