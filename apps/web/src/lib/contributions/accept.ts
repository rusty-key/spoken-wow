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
 * picked -- stays as displayed; a moderator who writes the `$G` back splits the line by player
 * gender (quests/text.ts).
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
  type NpcRowKind,
  type NpcResolution,
} from "@/lib/npc/store";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import type { CorpusLine } from "@/lib/corpus";
import { isGeneratable } from "@/lib/books/tools";
import { branchesOnPlayerGender, speakPlayerTokens } from "@/lib/player-words";
import { corpus } from "@/lib/quests/catalogue";
import type { Roster } from "@/lib/voices/roster";
import { loadRoster } from "@/lib/voices/roster-store";

import type { ContributionStatus } from "./contributions";
import {
  answersQuestMomentSql,
  baseLineId,
  lineIdentityFor,
  playerGenderForms,
  type LineIdentity,
} from "./naming";
import { gossipIdentity, recordBroadcast, resolveGossip, type GossipPlan } from "./gossip";
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

/**
 * Who speaks a contribution's line. `race` and `gender` are the ones its voice's files are named
 * by (migration 0071's voice table), not the NPC's type: a gameobject's greeting hashes and
 * matches as the narrator's, as every one the extract wrote does.
 */
type Speaker = {
  npcId: number;
  npcName: string | null;
  npcType: NpcRowKind;
  race: string;
  gender: string;
  flavor: string | null;
  /** "" while no voice reads the NPC's type, which speakerFor refuses. */
  voice: string;
};

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

/** Who speaks a quests contribution, from the npc table -- the same lookup triage.ts's page renders from. */
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

  if (!resolution?.race) return null;

  const roster = await loadRoster();
  const voice = roster.voiceFor(resolution.race, resolution.gender, resolution.flavor);
  const family = voice ? roster.familyOf(voice) : null;
  return {
    npcId: observed.npcId,
    npcName: resolution.npcName ?? observed.npcName,
    npcType: resolution.npcKind,
    race: family?.race ?? resolution.race,
    gender: family?.gender ?? resolution.gender ?? "",
    flavor: resolution.flavor,
    voice: voice ?? "",
  };
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
  // A line in no voice would be unvoiceable and unfindable: giving the NPC's type a voice is
  // the fix, not accepting the line anyway.
  if (!speaker.voice || !(await loadRoster()).isVoice(speaker.voice)) {
    return {
      ok: false,
      reason: "needs-speaker",
      // With no voice, race and gender are still the NPC's own (resolvedSpeaker).
      message: `No voice reads ${[speaker.race, speaker.gender, speaker.flavor].filter(Boolean).join("-")} yet -- give it one under NPCs → Types.`,
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
  const index = indexOf(lines, await loadRoster());
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
  const { rowCount } = await (client ?? db()).query(
    `select 1 from "quest_line_speaker" where "contributionId" = $1
     union all
     select 1 from "quest_line" where "origin" = 'contributed' and "note" = $2
     limit 1`,
    [contributionId, noteFor(contributionId)],
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
 * The quests rows whose moment already has a speaker, in any language, by id. Accepting one of
 * those writes only the language's text; the rest need a speaker answered first.
 */
export async function momentHasSpeaker(contributions: readonly Contribution[]): Promise<Set<number>> {
  const moments = momentsOf(contributions);
  if (moments.length === 0) return new Set();
  const { rows } = await db().query<{ id: number }>(
    `select m."id" from unnest($1::int[], $2::text[]) as m ("id", "lineId")
      where exists (select 1 from "quest_line_speaker" s
                     where ${answersQuestMomentSql(`s."lineId"`, `m."lineId"`)})`,
    [moments.map((m) => m.id), moments.map((m) => m.lineId)],
  );
  return new Set(rows.map((row) => row.id));
}

/** Each quest-moment contribution's moment id; gossip names none. */
function momentsOf(contributions: readonly Contribution[]): { id: number; lineId: string; lang: string }[] {
  return contributions.flatMap((c) => {
    if (c.source !== "quests" || !(c.meta.quest && c.meta.event)) return [];
    const identity = lineIdentityFor(c.meta, c.text ?? "", "", "");
    return identity ? [{ id: c.id, lineId: identity.lineId, lang: c.locale }] : [];
  });
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
      speaker.voice, contributionId,
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
  lang: Lang = BASE_LANG,
): Promise<void> {
  const { rowCount } = await client.query(
    `select 1 from "quest_line_speaker" where "lineId" = $1 and "npcType" = $2 and "npcId" = $3`,
    [lineId, speaker.npcType, speaker.npcId],
  );
  if (!rowCount) await insertSpeaker(client, contributionId, lineId, variant, speaker, lang);
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
 * Accepting a quest moment, the same in every language: the language's own row for it, and a
 * speaker only when the moment has none in any language yet. Who speaks a line is a fact about
 * the world, so a speaker one language wrote voices the line in every other.
 *
 * A moment the language already has is left alone: an import or a translator got there first.
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
  if (await momentTaken(client, lang, identity.lineId)) return null;

  const rows = await ownRows(client, identity, text, lang);

  const { rowCount: spoken } = await client.query(
    `select 1 from "quest_line_speaker" where ${answersQuestMomentSql(`"lineId"`, "$1")} limit 1`,
    [identity.lineId],
  );
  let speaker: Speaker | null = null;
  if (!spoken) {
    const found = await speakerFor(contribution);
    if (!found.ok) return found;
    speaker = found.speaker;
  }

  for (const row of rows) {
    await insertLine(client, contribution.id, userId, row, text, lang);
    if (speaker) await insertSpeaker(client, contribution.id, row.lineId, 0, speaker, lang);
  }
  if (lang !== BASE_LANG) {
    for (const name of namesSeenIn(contribution)) {
      await nameIfUnnamed(client, { ...name, lang, userId, note: noteFor(contribution.id) });
    }
  }
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

/** Whether a books contribution has written a page -- the books side of contributedLineExists. */
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
 * as accept leaves a quest moment: an import or a translator got there first. The
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
        : await contributedLineExists(id, client);

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
      await insertSpeaker(client, contribution.id, prepared.identity.lineId, 0, prepared.speaker, BASE_LANG);
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
        if (plan.kind === "line") await insertSpeaker(client, contribution.id, row.lineId, 0, speaker, lang);
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
