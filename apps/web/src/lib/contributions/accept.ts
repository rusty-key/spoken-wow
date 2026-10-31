/**
 * Resolving a contribution -- the route's whole verb, now that accepting a quests row can also
 * write a line.
 *
 * Everything except quests-accept and readables-accept is the plain status flip
 * setContributionStatus always did: a moderator moving any row to "new" or "rejected" changes
 * nothing else. Readables-accept writes the page in the row's language (acceptBookContribution).
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
 * picked -- stays as displayed; a moderator who writes the `$G` back splits the line by player
 * gender (quests/text.ts).
 */
import { skipReasonFor } from "@/lib/text-gate";
import type { PoolClient } from "pg";

import { BOOK_ID_COMPAT, PAGE_COUNT } from "@readables-tools/lib/page.mjs";
import { normaliseText } from "@readables-tools/lib/text.mjs";

import { recordActivity } from "@/lib/activity/store";
import { actAs, ALL_TEAMS, db, inTransaction } from "@/lib/db";
import { observedFrom } from "@/lib/npc/resolve";
import {
  getResolution,
  getResolutions,
  getResolutionsById,
  resolutionKey,
  type NpcRowKind,
  type NpcResolution,
} from "@/lib/npc/store";
import { BASE_LANG, CODES, isLang, type Lang } from "@/lib/lang";
import type { CorpusLine } from "@/lib/corpus";
import { isGeneratable, mintBookId, mintPageId } from "@/lib/readables/tools";
import { branchesOnPlayerGender, speakPlayerTokens } from "@/lib/player-words";
import { corpus } from "@/lib/quests/catalogue";
import { forgetIgnores, writeIgnore } from "@/lib/quests/ignores";
import {
  addToMoment,
  insertSpeaker,
  lockLine,
  momentSpeakers,
  speakerFromResolution,
  speaksMoment,
  type Speaker,
  type SpeakerRow,
} from "@/lib/quests/speakers";
import type { Roster } from "@/lib/voices/roster";
import { loadRoster } from "@/lib/voices/roster-store";
import { freshOwners } from "@/lib/teams/store";

import { loadBookCorpus, matchBook, sameMatch, type BookCorpus, type BookMatchResult } from "./book-match";
import { sameLine } from "./compare";
import type { ContributionStatus } from "./contributions";
import { momentTexts } from "./known";
import {
  answersQuestMomentSql,
  baseLineId,
  lineIdentityFor,
  momentOf,
  playerGenderForms,
  questWordingFileName,
  questWordingLineId,
  wordingsOfMomentSql,
  type LineIdentity,
  type QuestEvent,
} from "./naming";
import { gossipIdentity, recordBroadcast, resolveGossip, type GossipPlan } from "./gossip";
import { noVoice } from "./speaker";
import { noteFor, pageNotes } from "./notes";
import { CONTRIBUTION_COLUMNS, observationMeta, type Contribution } from "./store";
import { spokenFromTemplate } from "./tokens";
import { idOnlyResolution } from "./triage";

const COLUMNS = CONTRIBUTION_COLUMNS;

export type ResolveRefusal =
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "needs-speaker"; message: string }
  | { ok: false; reason: "needs-page"; message: string }
  | { ok: false; reason: "one-way"; message: string }
  | { ok: false; reason: "changed"; message: string }
  | { ok: false; reason: "malformed"; message: string };

export type ResolveOutcome = { ok: true; contribution: Contribution } | ResolveRefusal;

/**
 * What accept writes: a new line and its speaker, or only a speaker on a line already there.
 * `broadcastTextId` is the id a gossip line was found or minted by, recorded on the line.
 */
type Prepared =
  | { kind: "exists" }
  | { kind: "speaker"; lineId: string; variant: number; speaker: Speaker; broadcastTextId?: number | null }
  | { kind: "line"; identity: LineIdentity; text: string; speaker: Speaker; broadcastTextId?: number | null };

/**
 * The npc rows for many contributions' NPCs, read up front in two queries -- what
 * linesInExplorer hands resolvedSpeaker so a page of rows is not a round trip per row.
 */
type Resolutions = {
  byKey: Map<string, NpcResolution>;
  byId: Map<number, NpcResolution[]>;
};

async function resolutionsFor(contributions: readonly Contribution[]): Promise<Resolutions> {
  const keys: { npcKind: NpcRowKind; npcId: number }[] = [];
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

/** Who speaks a quests contribution, from the npc table -- the same lookup triage.ts's page renders from. */
async function resolvedSpeaker(
  meta: Record<string, string>,
  lang: Lang,
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

  return resolution ? speakerFromResolution(resolution, await loadRoster(lang), observed.npcName) : null;
}

/**
 * The catalogue, indexed for the questions prepareLine asks of it -- a
 * linear scan per row was most of what a page of accepted rows, or a batch accept, cost.
 *
 * `byPrefix` holds each line under its own id and under every shorter `:`-joined prefix of it,
 * which is exactly answersQuestMoment: `q:1:accept` finds `q:1:accept` and `q:1:accept:m`. A
 * voice's line is held under its line's id: its speakers are the line's.
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

function indexOf(lines: readonly CorpusLine[], roster: Roster): CorpusIndex {
  let index = corpusIndexes.get(lines);
  if (index) return index;
  index = { byPrefix: new Map(), gossipByText: new Map(), position: new Map() };
  for (const [position, line] of lines.entries()) {
    index.position.set(line, position);
    const parts = baseLineId(line.lineId).split(":");
    for (let end = parts.length; end >= 2; end--) pushTo(index.byPrefix, parts.slice(0, end).join(":"), line);
    if (parts.length < 2) pushTo(index.byPrefix, parts[0], line);
    if (line.source === "gossip") {
      // By the names its voice's files hash by, as a contribution's speaker is.
      const family = roster.familyOf(line.voice) ?? { race: line.race, gender: line.gender };
      pushTo(index.gossipByText, gossipTextKey(family.race, family.gender, normaliseText(line.originalText)), line);
    }
  }
  corpusIndexes.set(lines, index);
  return index;
}

async function speakerFor(
  contribution: Contribution,
  resolutions?: Resolutions,
): Promise<{ ok: true; speaker: Speaker } | Extract<ResolveRefusal, { reason: "needs-speaker" }>> {
  const speaker = await resolvedSpeaker(observationMeta(contribution), isLang(contribution.locale) ? contribution.locale : BASE_LANG, resolutions);
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
  // A line in no voice would be unvoiceable and unfindable: giving the NPC's type a voice is
  // the fix, not accepting the line anyway.
  if (!speaker.voice) {
    return {
      ok: false,
      reason: "needs-speaker",
      // With no voice, race and gender are still the NPC's own (resolvedSpeaker).
      message: `${noVoice(speaker)} -- give it one under NPCs → Types.`,
    };
  }
  return { ok: true, speaker };
}

/**
 * What accepting an English greeting writes, or a refusal. A gossip line is one text spoken by
 * many NPCs; already there (by id, or by text once the corpus's own trailing whitespace is
 * normalised away) means this NPC is added as one more speaker of it, unless they already are.
 */
async function prepareLine(
  contribution: Contribution,
  corpusLines?: readonly CorpusLine[],
  resolutions?: Resolutions,
): Promise<{ ok: true; prepared: Prepared } | ResolveRefusal> {
  const found = await speakerFor(contribution, resolutions);
  if (!found.ok) return found;
  const { speaker } = found;

  const identity = lineIdentityFor(contribution.meta, contribution.text, speaker.race, speaker.gender);
  if (!identity) return { ok: false, reason: "malformed", message: "gossip contribution has no text to hash" };
  if (!contribution.text) {
    return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  }

  const lines = corpusLines ?? (await corpus()).lines;

  // By id, or by text: 1,644 of the corpus's gossip lines carry trailing whitespace in
  // `originalText` that normaliseText (already applied to contribution.text at intake,
  // submission.ts) strips, so a verbatim duplicate of one of them hashes differently.
  // Whichever of the two comes first in the catalogue, as a scan for either would find.
  const text = contribution.text;
  // English's roster, as the lines matched against are English's corpus.
  const index = indexOf(lines, await loadRoster(BASE_LANG));
  const byId = (index.byPrefix.get(identity.lineId) ?? []).find(
    (l) => l.source === "gossip" && baseLineId(l.lineId) === identity.lineId,
  );
  const byText = index.gossipByText.get(gossipTextKey(speaker.race, speaker.gender, text))?.[0];
  const match =
    byId && byText ? (index.position.get(byId)! <= index.position.get(byText)! ? byId : byText) : (byId ?? byText);
  if (!match) {
    const plan = await resolveGossip(BASE_LANG, text, speaker, { skipText: true });
    return { ok: true, prepared: preparedFrom(plan, text, speaker) };
  }

  // The line the match is a voice of: speakers are written to the line, never to a voice's id.
  const lineId = baseLineId(match.lineId);
  const speaks = (index.byPrefix.get(lineId) ?? []).some(
    (l) => baseLineId(l.lineId) === lineId && l.npcType === speaker.npcType && l.npcId === speaker.npcId,
  );
  if (speaks) return { ok: true, prepared: { kind: "exists" } };
  return { ok: true, prepared: { kind: "speaker", lineId, variant: 0, speaker } };
}

/** An English gossip plan as prepareLine's answer: English has no translation to write. */
function preparedFrom(plan: GossipPlan, text: string, speaker: Speaker): Prepared {
  switch (plan.kind) {
    case "exists":
      return { kind: "exists" };
    case "speaker":
    case "translation":
      return { kind: "speaker", lineId: plan.lineId, variant: 0, speaker, broadcastTextId: plan.broadcastTextId };
    case "line":
      return { kind: "line", identity: plan.identity, text, speaker, broadcastTextId: plan.broadcastTextId };
  }
}

/**
 * Whether a quests contribution has written anything: a speaker row, or a line row a moment
 * that already had speakers took without one.
 */
export async function contributedLineExists(contributionId: number, client?: PoolClient): Promise<boolean> {
  return (await contributedLine(contributionId, client)) !== null;
}

/** The moment of the line a contribution's accept wrote (momentOf its id), or null for none. */
export async function contributedLine(contributionId: number, client?: PoolClient): Promise<string | null> {
  const { rows } = await (client ?? db()).query<{ lineId: string }>(
    `select "lineId" from "quest_line_speaker" where "contributionId" = $1
     union all
     select "lineId" from "quest_line" where "origin" = 'contributed' and "note" = $2
     limit 1`,
    [contributionId, noteFor(contributionId)],
  );
  return rows[0] ? momentOf(rows[0].lineId) : null;
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
  const readables = await readablesInExplorer(contributions);
  const candidates = contributions.filter((c) => c.source === "quests" && c.status === "accepted");
  if (candidates.length === 0) return readables;
  const quests = await questsInExplorer(candidates);
  return new Set([...readables, ...quests]);
}

/**
 * The quests rows whose moment already has their speaker, in any language, by id: one of the
 * moment's speakers is the row's NPC, or the row names none. Accepting one of those writes only
 * the language's text; the rest need a speaker answered first, since accepting makes their NPC
 * one more speaker of the moment (acceptQuestMoment).
 */
export async function momentHasSpeaker(contributions: readonly Contribution[]): Promise<Set<number>> {
  const moments = momentsOf(contributions);
  if (moments.length === 0) return new Set();
  const { rows } = await db().query<{ id: number }>(
    `select m."id" from unnest($1::int[], $2::text[], $3::int[], $4::text[]) as m ("id", "lineId", "npcId", "npcKind")
      where exists (select 1 from "quest_line_speaker" s
                     where ${answersQuestMomentSql(`s."lineId"`, `m."lineId"`)}
                       -- speaksMoment's rule, in SQL
                       and (m."npcId" is null
                            or (s."npcId" = m."npcId" and (m."npcKind" is null or s."npcType" = m."npcKind"))))`,
    [moments.map((m) => m.id), moments.map((m) => m.lineId), moments.map((m) => m.npcId), moments.map((m) => m.npcKind)],
  );
  return new Set(rows.map((row) => row.id));
}

/** Each quest-moment contribution's moment id; gossip names none. */
function momentsOf(
  contributions: readonly Contribution[],
): { id: number; lineId: string; lang: string; npcId: number | null; npcKind: string | null }[] {
  return contributions.flatMap((c) => {
    if (c.source !== "quests" || !(c.meta.quest && c.meta.event)) return [];
    const identity = lineIdentityFor(c.meta, c.text ?? "", "", "");
    const observed = observedFrom(observationMeta(c));
    return identity
      ? [{ id: c.id, lineId: identity.lineId, lang: c.locale, npcId: observed.npcId, npcKind: observed.npcKind }]
      : [];
  });
}

/**
 * The readables side of linesInExplorer: an accepted row is there once it has written its page,
 * as a first version or a correction.
 *
 * A row accepted before accept wrote readables rows in every language wrote nothing in English, and
 * in another language only where the page lacked that language: such an English row is there,
 * and another language's is once its page has that language's text.
 */
async function readablesInExplorer(contributions: readonly Contribution[]): Promise<Set<number>> {
  const accepted = contributions.filter((c) => c.source === "readables" && c.status === "accepted");
  const found = new Set(accepted.filter((c) => c.locale === BASE_LANG).map((c) => c.id));
  const rest = accepted.filter((c) => !found.has(c.id));
  if (rest.length === 0) return found;
  const { rows: notes } = await db().query<{ note: string }>(
    `select distinct "note" from "book_line" where "note" = any($1::text[])`,
    [rest.flatMap((c) => pageNotes(c.id))],
  );
  const written = new Set(notes.map((row) => row.note));
  for (const c of rest) if (pageNotes(c.id).some((note) => written.has(note))) found.add(c.id);
  const unwritten = rest.filter((c) => !found.has(c.id) && c.matchLineId !== null);
  if (unwritten.length === 0) return found;
  const { rows } = await db().query<{ id: number }>(
    `select c."id" from unnest($1::int[], $2::text[], $3::text[]) as c ("id", "lang", "lineId")
      where exists (select 1 from "book_line" b where b."lineId" = c."lineId" and b."lang" = c."lang")`,
    [unwritten.map((c) => c.id), unwritten.map((c) => c.locale), unwritten.map((c) => c.matchLineId)],
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
  const gossip = unwritten.filter((c) => c.locale === BASE_LANG && !(c.meta.quest && c.meta.event));
  const [moments, resolutions, lines] = await Promise.all([
    momentsInExplorer(unwritten),
    gossip.length ? resolutionsFor(gossip) : undefined,
    gossip.length ? corpus().then((c) => c.lines) : [],
  ]);
  for (const id of moments) found.add(id);
  for (const contribution of unwritten) {
    if (contribution.locale === BASE_LANG || (contribution.meta.quest && contribution.meta.event)) continue;
    const speaker = await speakerFor(contribution);
    if (!speaker.ok || !contribution.text || !isLang(contribution.locale)) continue;
    const plan = await resolveGossip(contribution.locale, contribution.text, speaker.speaker);
    if (plan.kind === "exists") found.add(contribution.id);
  }
  for (const contribution of gossip) {
    const result = await prepareLine(contribution, lines, resolutions);
    if (result.ok && result.prepared.kind === "exists") found.add(contribution.id);
  }
  return found;
}

/** A quest moment is in the explorer once the row's language has it, whoever wrote it. */
async function momentsInExplorer(contributions: readonly Contribution[]): Promise<number[]> {
  const moments = momentsOf(contributions);
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
  lang: Lang = BASE_LANG,
): Promise<void> {
  const { rowCount } = await client.query(
    `select 1 from "quest_line_speaker" where "lineId" = $1 and "npcType" = $2 and "npcId" = $3`,
    [lineId, speaker.npcType, speaker.npcId],
  );
  if (!rowCount) await insertSpeaker(client, { lineId, variant, lang, speaker, contributionId });
}

/** The structure a language's row for a moment takes: the id, file and player gender. */
type MomentRow = Pick<CorpusLine, "lineId" | "playerGender" | "fileName" | "questId"> & {
  source: string;
  questTitle: string | null;
  /** The English template, where English has the moment; the row's own text otherwise. */
  originalText: string | null;
};

/**
 * A contributed row for a quest moment, as its first version in `lang`. English speaks the
 * template with "adventurer" in place of $N, $C and $R; another language keeps them, as the
 * dump's own translations do, and is what that client showed, so it is `localeText` too.
 */
async function insertLine(
  client: PoolClient,
  contributionId: number,
  userId: string,
  row: MomentRow,
  template: string,
  lang: Lang,
): Promise<void> {
  const english = lang === BASE_LANG;
  // A progress line is kept but never voiced, as the extract marks its own: the game plays no
  // audio for that panel.
  const skipReason = english
    ? row.source === "progress" ? "progress" : null
    : skipReasonFor(row.source as LineIdentity["source"], template, lang, row.playerGender);
  await client.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
        "generatable", "skipReason", "editedBy", "note")
     values ($1, 0, $2, 1, true, 'contributed', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict do nothing`,
    [
      row.lineId, lang, row.source, row.questId, row.questTitle, row.playerGender, row.fileName,
      english ? spokenFromTemplate(template) : template, row.originalText ?? template,
      english ? null : template, skipReason === null, skipReason,
      userId, noteFor(contributionId),
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

/** English's original text for each of a moment's lines, by line id. */
async function englishOriginals(client: PoolClient, momentId: string): Promise<Map<string, string>> {
  const { rows } = await client.query<{ lineId: string; originalText: string }>(
    `select "lineId", "originalText" from "quest_line"
      where "lang" = $2 and "isCurrent" and "variant" = 0 and ${answersQuestMomentSql(`"lineId"`, "$1")}`,
    [momentId, BASE_LANG],
  );
  return new Map(rows.map((row) => [row.lineId, row.originalText]));
}

/**
 * A language's rows for a moment. Its own text decides whether that is one line or one per
 * player gender, whatever other languages made of the moment; a client has already picked one
 * side of any $G, so a contribution is almost always one line.
 */
async function ownRows(client: PoolClient, identity: LineIdentity, text: string, lang: Lang): Promise<MomentRow[]> {
  const originals = lang === BASE_LANG ? new Map<string, string>() : await englishOriginals(client, identity.lineId);
  return playerGenderForms(identity.lineId, identity.fileName, branchesOnPlayerGender(text)).map((form) => ({
    ...form,
    source: identity.source,
    questId: identity.questId,
    questTitle: lang === BASE_LANG ? identity.questTitle : null,
    // A language's row keeps the English template it translates: the same line's, else the
    // plain one's, else the male one's. English's own, or a line English lacks, is its words.
    originalText:
      originals.get(form.lineId) ?? originals.get(identity.lineId) ?? originals.get(`${identity.lineId}:m`) ?? text,
  }));
}

/**
 * Accepting a quest moment, the same in every language: the language's own row for it, and its
 * NPC as a speaker when the moment has none in any language yet, or has others but not this one
 * -- a quest two givers offer, each in their own voice (addToMoment). Who speaks a line is a fact
 * about the world, so a speaker one language wrote voices the line in every other.
 *
 * The text of a moment the language already has is left alone: an import or a translator got
 * there first.
 * The id and file are the quest's and the event's in every language, in the shape ownRows
 * gives them. In another language the quest's and the NPC's names the client showed are
 * written too (namesSeenIn).
 */
async function acceptQuestMoment(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
): Promise<ResolveRefusal | null> {
  const { event } = contribution.meta;
  const identity = lineIdentityFor(contribution.meta, contribution.text ?? "", "", "");
  if (!identity || !contribution.text) {
    return { ok: false, reason: "malformed", message: `unknown quest event "${event}"` };
  }
  const text = contribution.text;
  const lang = contribution.locale as Lang;

  // Under the moment's lock: a batch reads nothing up front, but two rows of it may share the
  // moment, and only one of them may find it missing.
  await lockLine(client, identity.lineId);
  const taken = await momentTaken(client, lang, identity.lineId);
  const speakers = await momentSpeakers(client, identity.lineId);
  const spoken = momentSpeaks(speakers, contribution);
  if (taken && spoken !== "others") return null;

  let speaker: Speaker | null = null;
  if (spoken !== "this-npc") {
    const found = await speakerFor(contribution);
    if (!found.ok) return found;
    speaker = found.speaker;
  }

  if (!taken) {
    for (const row of await ownRows(client, identity, text, lang)) {
      await insertLine(client, contribution.id, userId, row, text, lang);
      if (speaker && spoken === "nobody") {
        await insertSpeaker(client, { lineId: row.lineId, variant: 0, lang, speaker, contributionId: contribution.id });
      }
    }
  }
  if (speaker && spoken === "others") {
    await addToMoment(client, identity.lineId, speaker, { contributionId: contribution.id }, speakers);
  }
  if (lang !== BASE_LANG) {
    for (const name of namesSeenIn(contribution)) {
      await nameIfUnnamed(client, { ...name, lang, userId, note: noteFor(contribution.id) });
    }
  }
  return null;
}

/**
 * Another wording of a quest moment the corpus already has: the contribution's text as the
 * moment's next `:w{n}` line in its language, spoken by its NPC (naming.py says what a wording
 * is). Numbered past every wording the moment has in any language, under the moment's lock,
 * so two accepts never take one number.
 */
export async function writeWording(
  contribution: Contribution,
  userId: string,
): Promise<
  | { ok: true; lineId: string }
  | { ok: false; reason: "not-a-correction"; message: string }
  | Extract<ResolveRefusal, { reason: "needs-speaker" | "malformed" }>
> {
  const identity = lineIdentityFor(contribution.meta, contribution.text, "", "");
  if (!identity || identity.questId === null || !contribution.text) {
    return { ok: false, reason: "malformed", message: "Only a quest line can be another wording." };
  }
  const found = await speakerFor(contribution);
  if (!found.ok) return found;
  // Narrowed here: a closure does not keep the narrowing of a property.
  const questId = identity.questId;
  const text = contribution.text;
  const lang = contribution.locale as Lang;
  const event = identity.source as QuestEvent;

  return inTransaction(async (client) => {
    await lockLine(client, identity.lineId);
    // Decided under the lock, so an accept that waited on another's sees what it wrote: its
    // own wording again is done, and a text some wording already says is not another.
    const own = await contributedLine(contribution.id, client);
    if (own) return { ok: true as const, lineId: own };
    const lines = (await momentTexts([{ locale: lang, moment: identity.lineId }], client)).get(`${lang}|${identity.lineId}`);
    if (lines?.some((line) => sameLine(line.text, text))) {
      return { ok: false as const, reason: "not-a-correction" as const, message: "The corpus already has this text for the moment -- nothing to add." };
    }
    const n = await nextWording(client, identity.lineId);
    const wording: LineIdentity = {
      ...identity,
      lineId: questWordingLineId(questId, event, n),
      fileName: questWordingFileName(questId, event, n),
    };
    for (const row of await ownRows(client, wording, text, lang)) {
      await insertLine(client, contribution.id, userId, row, text, lang);
      await insertSpeaker(client, { lineId: row.lineId, variant: 0, lang, speaker: found.speaker, contributionId: contribution.id });
    }
    return { ok: true as const, lineId: wording.lineId };
  });
}

/** One past the highest wording a moment has in any language: 1 for a moment with only its first. */
async function nextWording(client: PoolClient, moment: string): Promise<number> {
  const { rows } = await client.query<{ n: number | null }>(
    `select max(substring("lineId" from ':w([0-9]+)(?::[mf])?$')::int) as "n"
       from "quest_line" where ${wordingsOfMomentSql(`"questId"`, `"source"`, "$1")}`,
    [moment],
  );
  return (rows[0].n ?? 0) + 1;
}

/**
 * Who already speaks a moment, in any language, as far as a contribution is concerned: nobody,
 * its own NPC (or it names none), or only others. A kind-less envelope's NPC is matched by id
 * alone, as idOnlyResolution answers it.
 */
function momentSpeaks(rows: SpeakerRow[], contribution: Contribution): "nobody" | "this-npc" | "others" {
  const observed = observedFrom(observationMeta(contribution));
  if (rows.length === 0) return "nobody";
  if (observed.npcId === null) return "this-npc";
  return speaksMoment(rows, observed.npcId, observed.npcKind) ? "this-npc" : "others";
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
): { kind: "quest" | NpcRowKind; entityId: string; name: string }[] {
  if (contribution.source !== "quests") return [];
  const names: { kind: "quest" | NpcRowKind; entityId: string; name: string }[] = [];
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

/**
 * Ignore every line a quests contribution wrote, in its language, or in every language for an
 * English row. A line it only added a speaker to is ignored whole, whoever else speaks it.
 */
async function ignoreWrittenLines(client: PoolClient, contribution: Contribution, userId: string): Promise<void> {
  const { rows } = await client.query<{ lineId: string }>(
    `select "lineId" from "quest_line_speaker" where "contributionId" = $1
     union
     select "lineId" from "quest_line" where "origin" = 'contributed' and "note" = $2`,
    [contribution.id, noteFor(contribution.id)],
  );
  const lang = contribution.locale === BASE_LANG || !isLang(contribution.locale) ? null : contribution.locale;
  for (const { lineId } of rows) {
    await writeIgnore(lineId, `Rejected ${noteFor(contribution.id)}`, userId, lang, client);
  }
}

/**
 * Whether a readables contribution has written a page, a first version or a correction -- the
 * readables side of contributedLineExists.
 */
async function contributedPageExists(contributionId: number, client: PoolClient): Promise<boolean> {
  const { rowCount } = await client.query(
    `select 1 from "book_line" where "note" = any($1::text[])`,
    [pageNotes(contributionId)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * A readables contribution, in any language: what the matcher says it is, written.
 *
 * Matched again here, inside the transaction and under a lock every readables accept takes, so two
 * pages of one new book accepted at once find each other rather than minting two books.
 * A page the game names keeps its id; one only a player's client has shown gets a minted
 * `b:n{uuid}`, in a minted `n{uuid}` book when it starts one. A correction is a new version of
 * that language's text, as an editor's save is; the rest is a first version, 'contributed'.
 * Known and ambiguous rows are refused: there is nothing to write, or nobody has said where.
 * With `expected`, the match the caller checked before accepting, a row that now matches
 * otherwise is refused rather than written as something nobody looked at.
 */
async function acceptBookContribution(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
  expected?: BookMatchResult,
): Promise<ResolveRefusal | null> {
  const text = contribution.text?.trim();
  if (!text) return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  const lang = contribution.locale as Lang;
  const title = contribution.meta.book?.trim() || null;
  // One readables accept at a time, in any language: two rows of one new page or book may be in
  // different languages, or shown under different titles.
  // The key keeps the section's old name: a release being replaced still takes that one.
  await client.query(`select pg_advisory_xact_lock(hashtext('books.accept'))`);

  const corpus = await loadBookCorpus(client);
  const match = matchBook(contribution, corpus);
  if (expected && !sameMatch(match, expected)) {
    return { ok: false, reason: "changed", message: "This page changed since you looked -- open it again." };
  }
  const note = noteFor(contribution.id);
  const { generatable, skipReason } = isGeneratable(speakPlayerTokens(text, lang));
  const words = { lang, title, text, generatable, skipReason, userId, note };

  let lineId: string;
  switch (match.kind) {
    case "ambiguous":
      return { ok: false, reason: "needs-page", message: "Several pages could be this one -- pick it first." };
    case "known":
      return { ok: false, reason: "malformed", message: "The corpus already has these words for this page." };
    case "correction":
      lineId = match.lineId;
      await client.query(
        `update "book_line" set "isCurrent" = false where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [lineId, lang],
      );
      await insertText(client, { ...words, lineId, origin: "edited" });
      break;
    case "translation":
      lineId = match.lineId;
      await insertText(client, { ...words, lineId, origin: "contributed" });
      break;
    case "new-page":
    case "new-book": {
      const bookId = match.kind === "new-page" ? match.bookId : mintBookId();
      lineId = mintPageId();
      await client.query(
        `insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, $3)`,
        [lineId, bookId, match.pageNumber],
      );
      await insertText(client, { ...words, lineId, origin: "contributed" });
      break;
    }
  }
  const firstOwner = await addOwner(client, lineId, contribution.meta, corpus);
  await nameOwnersIfUnnamed(client, { lineId, lang, title, userId, note, everyLanguage: firstOwner });
  return null;
}

/**
 * One language's text of a page, versioned after whatever that language already has. Throws
 * when book_page no longer has the page live: an import does not take accept's lock, and a
 * correction that wrote nothing would leave the language with no current text.
 */
async function insertText(
  client: PoolClient,
  row: {
    lineId: string;
    lang: Lang;
    title: string | null;
    text: string;
    generatable: boolean;
    skipReason: string | null;
    userId: string;
    note: string;
    origin: "contributed" | "edited";
  },
): Promise<void> {
  const { rowCount } = await client.query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId", "pageNumber", "pageCount",
        "title", "ownerKind", "ownerIds", "material", "text", "generatable", "skipReason", "editedBy", "note")
     select p."lineId", $2,
            coalesce((select max(m."version") from "book_line" m where m."lineId" = p."lineId" and m."lang" = $2), 0) + 1,
            true, $9, p."pageTextId", ${BOOK_ID_COMPAT}, p."pageNumber", ${PAGE_COUNT},
            coalesce($3, (select e."title" from "book_line" e
                           where e."lineId" = p."lineId" and (e."lang" = $2 or e."isCurrent")
                           order by (e."lang" = $2) desc, e."version" desc, e."lang" limit 1), ''),
            p."ownerKind", p."ownerIds", coalesce(p."material", 0), $4, $5, $6, $7, $8
       from "book_page" p where p."lineId" = $1 and p."aliasOf" is null`,
    [row.lineId, row.lang, row.title, row.text, row.generatable, row.skipReason, row.userId, row.note, row.origin],
  );
  if (rowCount !== 1) throw new Error(`book page ${row.lineId} is gone or an alias; match the contribution again`);
}

/**
 * The page's owners named where a language has no name for them, since the catalogue titles an
 * owned page from entity_name rather than from the row: in the row's language, the title the
 * client showed. With `everyLanguage`, for an owner the page has only just been given, every
 * language's own title for the page too, so a language that read it by its row's title still
 * does.
 */
async function nameOwnersIfUnnamed(
  client: PoolClient,
  args: { lineId: string; lang: Lang; title: string | null; userId: string; note: string; everyLanguage: boolean },
): Promise<void> {
  const { rows } = await client.query<{ ownerKind: string | null; ownerIds: number[] | null }>(
    `select "ownerKind", "ownerIds" from "book_page" where "lineId" = $1`,
    [args.lineId],
  );
  const { ownerKind, ownerIds } = rows[0] ?? {};
  if (!ownerKind) return;
  const names = new Map<string, string>();
  if (args.everyLanguage) {
    const { rows: titled } = await client.query<{ lang: string; title: string }>(
      `select "lang", "title" from "book_line" where "lineId" = $1 and "isCurrent" and "title" <> ''`,
      [args.lineId],
    );
    for (const { lang, title } of titled) names.set(lang, title);
  }
  if (args.title) names.set(args.lang, args.title);
  for (const [lang, name] of names) {
    for (const owner of ownerIds ?? []) {
      await nameIfUnnamed(client, {
        kind: ownerKind === "object" ? "gameobject" : "item",
        entityId: String(owner),
        lang: lang as Lang,
        name,
        userId: args.userId,
        note: args.note,
      });
    }
  }
}

/**
 * The item or object the client read this page from, added to the page's owners when no page
 * in the corpus has it: Forever renumbered some objects, and the next client to open one finds
 * the page by id rather than by its words. Answers whether that gave an ownerless page its first
 * owner.
 */
async function addOwner(
  client: PoolClient,
  lineId: string,
  meta: Record<string, string>,
  corpus: BookCorpus,
): Promise<boolean> {
  let first = false;
  for (const kind of ["item", "object"] as const) {
    const id = Number(meta[kind]);
    if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) continue;
    if (corpus.byOwner.has(`${kind}:${id}`)) continue;
    const { rows } = await client.query<{ first: boolean }>(
      `update "book_page" p set "ownerKind" = coalesce(p."ownerKind", $2),
              "ownerIds" = array_append(coalesce(p."ownerIds", '{}'), $3::int)
         from (select "lineId", "ownerKind" is null as "first" from "book_page" where "lineId" = $1) was
        where p."lineId" = was."lineId" and (p."ownerKind" is null or p."ownerKind" = $2)
          and not ($3::int = any(coalesce(p."ownerIds", '{}')))
        returning was."first"`,
      [lineId, kind, id],
    );
    if (rows[0]?.first) first = true;
  }
  return first;
}

/**
 * Change a contribution's status, writing its line into the quest tables first when the target
 * is "accepted" for a fresh quests row.
 *
 * `corpusLines` is the English catalogue to match against, read by the caller -- a batch reads
 * it once for all its rows. Left out, it is read here. `bookMatch` is what the caller saw a
 * readables row match; the accept refuses when the row matches otherwise by the time it writes.
 */
export async function resolveContribution(
  id: number,
  status: ContributionStatus,
  userId: string,
  corpusLines?: readonly CorpusLine[],
  // Whether the resolver may ignore the line in the contribution's language (English meaning
  // every language), which rejecting a written quests row does.
  mayIgnore = false,
  bookMatch?: BookMatchResult,
): Promise<ResolveOutcome> {
  // Read before the client is held: a refresh of the memo needs a connection of its own. Every
  // language, since the contribution's is not known yet: one the other worker has just given a
  // team would otherwise be logged under none.
  const owners = await freshOwners(CODES);
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

    // What this writes is shared but for its activity row, the language's team's, and the
    // ignores a rejection leaves. An English row's are on every language: system work.
    const lang = isLang(contribution.locale) ? contribution.locale : null;
    const siteWide = status === "rejected" && mayIgnore && (lang === null || lang === BASE_LANG);
    await actAs(client, (!siteWide && lang && owners.get(lang)) || ALL_TEAMS);

    const written =
      contribution.source === "readables"
        ? await contributedPageExists(id, client)
        : await contributedLineExists(id, client);

    // A written row never goes back to new: audio may already exist for its line. Rejecting a
    // written quests row ignores what it wrote instead, which keeps the rows and takes, so
    // lifting the ignore in the explorer undoes it.
    let ignored = false;
    if (written && status !== "accepted") {
      if (status === "rejected" && contribution.source === "quests" && mayIgnore) {
        await ignoreWrittenLines(client, contribution, userId);
        ignored = true;
      } else {
        await client.query("rollback");
        return {
          ok: false,
          reason: "one-way",
          message:
            status === "rejected" && contribution.source === "quests"
              ? "This line is already in the explorer; rejecting it ignores it there, which you may not do."
              : "This line is already in the explorer; ignore it there instead.",
        };
      }
    }

    if (status === "accepted" && contribution.source === "readables" && !written) {
      const refused = await acceptBookContribution(client, contribution, userId, bookMatch);
      if (refused) {
        await client.query("rollback");
        return refused;
      }
    } else if (status === "accepted" && contribution.source === "quests" && !written) {
      const refused = contribution.meta.quest && contribution.meta.event
        ? await acceptQuestMoment(client, contribution, userId)
        : await acceptGossip(client, contribution, userId, corpusLines);
      if (refused) {
        await client.query("rollback");
        return refused;
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
    if (ignored) forgetIgnores();
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

/**
 * Accepting a greeting. In English, a new line and this NPC as its speaker, or this NPC added as
 * one more speaker of a line the tables have; in another language, acceptTranslatedGossip.
 */
async function acceptGossip(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
  corpusLines?: readonly CorpusLine[],
): Promise<ResolveRefusal | null> {
  if (contribution.locale !== BASE_LANG) return acceptTranslatedGossip(client, contribution, userId);
  const result = await prepareLine(contribution, corpusLines);
  if (!result.ok) return result;
  const { prepared } = result;
  if (prepared.kind === "line") {
    // Checked again under the line's lock: a concurrent accept of another contribution for the
    // same line may have written it since prepareLine read the catalogue. Then this NPC is one
    // more speaker of it, as prepareLine would have said had it seen the line.
    await lockLine(client, prepared.identity.lineId);
    const { rowCount } = await client.query(
      `select 1 from "quest_line" where "lang" = $1 and "lineId" = $2`,
      [BASE_LANG, prepared.identity.lineId],
    );
    if (rowCount) {
      await addSpeakerOnce(client, contribution.id, prepared.identity.lineId, 0, prepared.speaker);
    } else {
      await insertLine(
        client, contribution.id, userId,
        { ...prepared.identity, playerGender: null, originalText: prepared.text },
        prepared.text, BASE_LANG,
      );
      await insertSpeaker(client, {
        lineId: prepared.identity.lineId, variant: 0, lang: BASE_LANG, speaker: prepared.speaker, contributionId: contribution.id,
      });
    }
  } else if (prepared.kind === "speaker") {
    await lockLine(client, prepared.lineId);
    await addSpeakerOnce(client, contribution.id, prepared.lineId, prepared.variant, prepared.speaker);
  }
  if (prepared.kind !== "exists") {
    await recordBroadcast(
      client,
      prepared.kind === "line" ? prepared.identity.lineId : prepared.lineId,
      prepared.broadcastTextId ?? null,
    );
  }
  return null;
}

/**
 * A greeting sent from a pack in another language (gossip.ts says how it is matched): nothing
 * when the language has the line, one more speaker when this NPC was not among its speakers,
 * the language's row over a line English has, or a line of the language's own.
 */
async function acceptTranslatedGossip(
  client: PoolClient,
  contribution: Contribution,
  userId: string,
): Promise<ResolveRefusal | null> {
  const text = contribution.text;
  if (!text) return { ok: false, reason: "malformed", message: "contribution has no text to voice" };
  const found = await speakerFor(contribution);
  if (!found.ok) return found;
  const { speaker } = found;
  const lang = contribution.locale as Lang;

  const plan = await resolveGossip(lang, text, speaker, { client });
  const lineId = plan.kind === "line" ? plan.identity.lineId : plan.lineId;
  await lockLine(client, lineId);
  if (plan.kind === "speaker") {
    await addSpeakerOnce(client, contribution.id, lineId, 0, speaker, plan.lang);
  } else if (plan.kind !== "exists") {
    // A translation of English's moment or a line of the language's own, shaped by its own text
    // as a quest moment is.
    const identity = plan.kind === "line" ? plan.identity : gossipIdentity(lineId);
    if (!(await momentTaken(client, lang, identity.lineId))) {
      for (const row of await ownRows(client, identity, text, lang)) {
        await insertLine(client, contribution.id, userId, row, text, lang);
        if (plan.kind === "line") await insertSpeaker(client, { lineId: row.lineId, variant: 0, lang, speaker, contributionId: contribution.id });
      }
    }
    if (plan.kind === "translation" && plan.addSpeaker) await addSpeakerOnce(client, contribution.id, lineId, 0, speaker);
  }
  await recordBroadcast(client, lineId, plan.broadcastTextId);
  for (const name of namesSeenIn(contribution)) {
    await nameIfUnnamed(client, { ...name, lang, userId, note: noteFor(contribution.id) });
  }
  return null;
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
 * landed. A row that throws is answered as an Error, in its place. `bookMatches` holds, per
 * readables row, the match the caller checked it by (resolveContribution's `bookMatch`).
 */
export async function resolveContributions(
  ids: readonly number[],
  status: ContributionStatus,
  userId: string,
  // resolveContribution's mayIgnore, per row.
  mayIgnore: (id: number) => boolean = () => false,
  bookMatches?: ReadonlyMap<number, BookMatchResult>,
): Promise<Map<number, ResolveOutcome | Error>> {
  const corpusLines = status === "accepted" ? (await corpus()).lines : undefined;
  const outcomes = new Map<number, ResolveOutcome | Error>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        outcomes.set(id, await resolveContribution(id, status, userId, corpusLines, mayIgnore(id), bookMatches?.get(id)));
      } catch (error) {
        outcomes.set(id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, ids.length) }, worker));
  return outcomes;
}
