/**
 * The quest corpus as the explorer sees it: every line, with who speaks it.
 *
 * SERVER ONLY, and the counterpart of lib/zones/catalogue.ts and lib/books/catalogue.ts --
 * the third section finally reading its corpus from the same place as the other two. It
 * used to come from corpus/corpus.json.gz, memoised forever on the reasoning that "the
 * corpus ships inside the release and cannot change under a running process". That stopped
 * being true the moment a line could be edited here.
 *
 * The rows are joined back into exactly the shape the file had -- one row per (line ×
 * speaker) -- so lib/search.ts, lib/facets.ts and everything downstream are unchanged.
 * That is deliberate: the point of this change is where the words live, not what the
 * explorer does with them.
 *
 * MEMOISED AGAINST A STAMP THE TABLES THEMSELVES CARRY, copied from books
 * (lib/books/catalogue.ts): max id, count, and the sum of live ids. Three terms because
 * there are three ways the table moves -- an edit inserts a version so the highest id
 * moves, an import can delete so the count moves, and a restore moves the live flag
 * between rows that already exist, which only the sum of live ids notices. The speakers
 * count separately, being replaced wholesale on every import.
 *
 * pm2 runs two workers, so an in-process invalidation would be a memo one worker drops and
 * the other keeps serving. There is deliberately no invalidate() for that reason.
 */
import "server-only";

import { query } from "@/lib/db";
import { memoByLang } from "@/lib/memo";
import { nameStamp, versionStamp } from "@/lib/stamp";
import type { Corpus, CorpusLine } from "@/lib/corpus";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { momentSql, variantFileName, variantLineId } from "@/lib/contributions/naming";
import { newVoiceName, type Roster } from "@/lib/voices/roster";
import { loadRoster, ROSTER_STAMP } from "@/lib/voices/roster-store";


/**
 * The corpus holds no lines at all, which is a different thing from a search matching none.
 *
 * Between a fresh database and the first import this is the normal state, and a page that
 * says "run the import" is a better answer than one that looks like the game has no quests
 * in it. Both other sections have had this; quests could not, because a missing file threw
 * somewhere further down.
 */
export class CorpusEmpty extends Error {
  constructor(lang: Lang = BASE_LANG) {
    super(
      lang === BASE_LANG
        ? "quest_line holds no English lines -- seed it with: make quests-import-corpus " +
            "(and check DATABASE_URL points at the database you mean)"
        : `quest_line holds no ${lang} lines yet`,
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Whether a thrown thing is that, across the module boundary.
 *
 * `instanceof` would be enough in one process and this is not defensive dressing: `next
 * dev` re-evaluates modules, so a route holding one evaluation's class can be handed an
 * error built by another's, and the two are not the same constructor. The name survives.
 */
export function isCorpusEmpty(error: unknown): boolean {
  return error instanceof Error && error.name === "CorpusEmpty";
}

/**
 * Speakers have no live flag, so their max id and count are the whole stamp; an NPC's answer is
 * updated in place, so its latest write is. Both voice every catalogue, and so does the roster
 * (migration 0071), which an admin edits without touching either.
 */
const SPEAKER_STAMP = `(select coalesce(max("id"), 0) || ':' || count(*) from "quest_line_speaker") || '/' ||
  (select coalesce(max("updatedAt")::text, '') || ':' || count(*) from "npc") || '/' ||
  ${ROSTER_STAMP}`;

async function stampOf(lang: Lang): Promise<string> {
  // Speakers and NPCs are every language's, so every catalogue moves when any of them do, and so
  // do English NPC names, which name another language's speakers (SPEAKER_NAME). Another language
  // also reads English's rows for display, and its own names.
  const english = `${versionStamp("quest_line", `"lang" = '${BASE_LANG}'`)} || '/' || ${SPEAKER_STAMP} || '/' ||
    ${versionStamp("entity_name", `"lang" = '${BASE_LANG}' and "kind" in ('creature', 'gameobject', 'item')`)}`;
  const rows = await query<{ stamp: string }>(
    lang === BASE_LANG
      ? `select ${english} as "stamp"`
      : `select ${english} || '|' || ${versionStamp("quest_line", `"lang" = $1`)} || '/' ||
                ${nameStamp(["quest", "creature", "gameobject", "item"])} as "stamp"`,
    lang === BASE_LANG ? [] : [lang],
  );
  return rows[0]?.stamp ?? "";
}

/**
 * A speaker row keeps the name its client showed, so one another language wrote names the NPC in
 * that language. The NPC's English name stands in for it where English has one.
 */
const SPEAKER_NAME = `case when r."lang" = '${BASE_LANG}' then r."npcName" else coalesce(
    (select en."name" from "entity_name" en
      where en."kind" = r."npcType" and en."entityId" = r."npcId"::text
        and en."lang" = '${BASE_LANG}' and en."isCurrent"), r."npcName") end`;

/**
 * Who speaks each line, whichever language wrote the speaker: a speaker is a fact about the
 * world, not about a language. The extract's English speakers where a line has any; otherwise
 * the ones a language wrote when it accepted the line first, each NPC once.
 *
 * Race, gender and flavor are the NPC's and nobody else's (migration 0070), so an answer given
 * for an NPC voices every line it speaks. Migration 0071 gave every speaker's NPC an answer; one
 * that still has no type has no voice.
 */
function speakersBy(key: string): string {
  return `(
  select r."id", r."key", r."lineId", r."variant", r."lang", r."ord", r."npcType", r."npcId", ${SPEAKER_NAME} as "npcName",
         r."contributionId", r."voice" as "writtenVoice",
         coalesce(n."race", '') as "race",
         coalesce(n."gender", '') as "gender",
         n."flavor" as "flavor"
    from (
      select s.*, ${key} as "key",
             bool_or(s."lang" = '${BASE_LANG}') over (partition by ${key}, s."variant") as "hasEnglish",
             row_number() over (
               partition by ${key}, s."variant", s."npcType", s."npcId", s."lang" = '${BASE_LANG}'
               order by s."ord", s."id"
             ) as "nth",
             first_value(s."lineId") over (
               partition by ${key}, s."variant", s."lang" = '${BASE_LANG}' order by s."ord", s."id"
             ) as "firstLine"
        from "quest_line_speaker" s
    ) r
    left join "npc" n
      on n."npcKind" = r."npcType" and n."npcId" = r."npcId"
   where case when r."hasEnglish" then r."lang" = '${BASE_LANG}' and r."lineId" = r."firstLine" else r."nth" = 1 end
)`;
}

const SPEAKERS = speakersBy(`s."lineId"`);

/**
 * Each moment's speakers, shared by its plain and player-gender lines in every language. English's
 * `:m` and `:f` lines carry the same NPCs, so a moment takes its first English line's.
 */
const MOMENT_SPEAKERS = speakersBy(momentSql(`s."lineId"`));

/**
 * Every NPC speaks a line in its own voice. Where NPCs of different voices share one, the file
 * already made keeps the voice it was made in -- the one its speakers were written with -- and
 * each other voice is a line of its own (naming.ts's variantLineId): the same words, in a file
 * named after the voice. An NPC whose voice changes moves to its new voice's line, which has no
 * audio until somebody generates it; one with no flavor yet moves to a line nobody can voice
 * until it gets one. Progress text is never voiced, so it is never split.
 */
const OWN_VOICE_SOURCES: ReadonlySet<string> = new Set(["accept", "complete", "gossip", "followup"]);

type Speaking = {
  lineId: string;
  variant: number;
  source: string;
  race: string;
  gender: string;
  flavor: string | null;
  writtenVoice: string;
  fileName: string;
  generatable: boolean;
  skipReason: string | null;
};

function voiced<T extends Speaking>(rows: T[], roster: Roster): (T & { voice: string })[] {
  const written = new Map<string, string>();
  const lineOf = (row: T) => `${row.lineId}|${row.variant}`;
  for (const row of rows) if (!written.has(lineOf(row))) written.set(lineOf(row), row.writtenVoice);

  return rows.map((row) => {
    // An NPC with no type has no voice to move to: its file stays, and nothing can make it again
    // until somebody says who the NPC is.
    if (!row.race) {
      const silenced = OWN_VOICE_SOURCES.has(row.source) && row.generatable;
      return { ...row, voice: row.writtenVoice, ...(silenced ? { generatable: false, skipReason: "no-voice" } : {}) };
    }
    // A combination no voice reads yet still gets its own line, named as its voice would be.
    const voice =
      roster.voiceFor(row.race, row.gender || null, row.flavor) ??
      newVoiceName(row.race, row.gender, row.flavor);
    if (!OWN_VOICE_SOURCES.has(row.source) || voice === written.get(lineOf(row))) return { ...row, voice };
    return {
      ...row,
      voice,
      lineId: variantLineId(row.lineId, voice),
      fileName: variantFileName(row.fileName, voice),
      ...(row.generatable && !roster.isVoice(voice) ? { generatable: false, skipReason: "no-voice" } : {}),
    };
  });
}

type Row = {
  lineId: string;
  variant: number;
  source: string;
  questId: number | null;
  questTitle: string | null;
  npcId: number;
  npcName: string;
  npcType: string;
  race: string;
  gender: string;
  flavor: string | null;
  /** The voice the speaker row was written with: the one the line's own file was made in. */
  writtenVoice: string;
  playerGender: string | null;
  text: string;
  originalText: string;
  fileName: string;
  generatable: boolean;
  skipReason: string | null;
  contributionId: number | null;
};

/**
 * One row per speaker, in the corpus's own order.
 *
 * `ord` is what makes that order reproducible: the corpus is a flat list and the export
 * has to give the addon build back the same list. Reading in the same order here means a
 * search result is ordered the way it always was, which paging depends on.
 */
async function build(lang: Lang): Promise<CorpusLine[]> {
  if (lang !== BASE_LANG) return buildTranslated(lang);
  const rows = await query<Row>(
    `select l."lineId", l."variant", l."source", l."questId", l."questTitle",
            s."npcId", s."npcName", s."npcType", s."race", s."gender", s."flavor", s."writtenVoice",
            l."playerGender", l."text", l."originalText", l."fileName",
            l."generatable", l."skipReason", s."contributionId"
       from ${SPEAKERS} s
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = $1 and l."isCurrent"
      order by s."lang" <> $1, s."ord"`,
    [lang],
  );

  if (rows.length === 0) throw new CorpusEmpty(lang);

  return voiced(rows, await loadRoster()).map(({ writtenVoice: _written, ...row }) => ({
    ...row,
    npcType: row.npcType as CorpusLine["npcType"],
    source: row.source as CorpusLine["source"],
    playerGender: row.playerGender as CorpusLine["playerGender"],
  }));
}

/**
 * Another language's lines: the ones it has, and every English line it has not translated.
 *
 * A LINE IS THE LANGUAGE'S OWN ROW: its text, file and structure. English is joined only to
 * show what the line says in English, and to stand in, marked `missing`, for a line this
 * language has no text for. That is a rendering, never a row: nothing here is written back,
 * exported or voiced, and a missing line is not generatable, so English cannot be recorded
 * under the language's name. A line English lacks carries no `english`.
 *
 * A LANGUAGE'S TEXT DECIDES ITS LINES. Where it branches on the player's gender a moment is two
 * lines, `:m` and `:f`, and otherwise one, whatever English does. Its speakers are the moment's,
 * and its English is the matching line: the same id, else the plain one, else the male one. A
 * moment the language has no row for lists English's lines, untranslated.
 *
 * ONE ROW PER LINE ID AND SPEAKER, NOT PER VARIANT. A second English variant is the same
 * quest in another content patch -- kept in English for the addon's title lookup -- and it
 * shares the first's file and its speakers. A language has one text for it
 * (locale_import.py writes it as variant 0), so a second row would list the same mp3 twice.
 */
async function buildTranslated(lang: Lang): Promise<CorpusLine[]> {
  const rows = await query<
    Row & {
      textMissing: boolean;
      titleMissing: boolean;
      nameMissing: boolean;
      native: boolean;
      englishTitle: string | null;
      englishName: string;
    }
  >(
    `with "own" as (
       select "id", "lineId", ${momentSql(`"lineId"`)} as "moment" from "quest_line"
        where "lang" = $1 and "variant" = 0 and "isCurrent"
     ), "lines" as (
       select "lineId", "moment", "id" as "ownId" from "own"
       union all
       select e."lineId", ${momentSql(`e."lineId"`)}, null from "quest_line" e
        where e."lang" = '${BASE_LANG}' and e."variant" = 0 and e."isCurrent"
          and not exists (select 1 from "own" o where o."moment" = ${momentSql(`e."lineId"`)})
     )
     select ln."lineId", s."variant",
            coalesce(t."source", e."source") as "source",
            coalesce(t."questId", e."questId") as "questId",
            coalesce(qn."name", t."questTitle", e."questTitle") as "questTitle",
            s."npcId", coalesce(nn."name", s."npcName") as "npcName", s."npcType",
            s."race", s."gender", s."flavor", s."writtenVoice",
            coalesce(t."playerGender", e."playerGender") as "playerGender",
            coalesce(t."text", e."text") as "text",
            coalesce(e."originalText", t."originalText") as "originalText",
            coalesce(t."fileName", e."fileName") as "fileName",
            coalesce(t."generatable", false) as "generatable",
            case when t."id" is null then 'untranslated' else t."skipReason" end as "skipReason",
            s."contributionId",
            t."id" is null as "textMissing",
            coalesce(t."questId", e."questId") is not null and qn."id" is null as "titleMissing",
            nn."id" is null as "nameMissing",
            e."id" is null as "native",
            e."questTitle" as "englishTitle", s."npcName" as "englishName"
       from "lines" ln
       join ${MOMENT_SPEAKERS} s on s."key" = ln."moment" and s."variant" = 0
       left join "quest_line" t on t."id" = ln."ownId"
       -- The English it translates: the same line, else the moment's plain one, else its male one.
       left join lateral (
         select * from "quest_line" e
          where e."lineId" = any(array[ln."lineId", ln."moment", ln."moment" || ':m'])
            and e."variant" = 0 and e."lang" = '${BASE_LANG}' and e."isCurrent"
          order by e."lineId" = ln."lineId" desc, e."lineId" = ln."moment" desc
          limit 1
       ) e on true
       left join "entity_name" qn
         on qn."kind" = 'quest' and qn."entityId" = coalesce(t."questId", e."questId")::text
        and qn."lang" = $1 and qn."isCurrent"
       left join "entity_name" nn
         on nn."kind" = s."npcType" and nn."entityId" = s."npcId"::text
        and nn."lang" = $1 and nn."isCurrent"
      order by s."lang" <> '${BASE_LANG}', s."ord", ln."lineId"`,
    [lang],
  );

  if (rows.length === 0) throw new CorpusEmpty();

  return voiced(rows, await loadRoster()).map((raw) => {
    const { textMissing, titleMissing, nameMissing, native, englishTitle, englishName, writtenVoice: _written, ...row } = raw;
    return {
      ...row,
      lang,
      ...(native ? {} : { english: { questTitle: englishTitle, npcName: englishName } }),
      npcType: row.npcType as CorpusLine["npcType"],
      source: row.source as CorpusLine["source"],
      playerGender: row.playerGender as CorpusLine["playerGender"],
      ...(textMissing || titleMissing || nameMissing
        ? { missing: { text: textMissing, questTitle: titleMissing, npcName: nameMissing } }
        : {}),
    };
  });
}

// One memo per language (lib/memo.ts). A single slot would be rebuilt on every request that
// asked for a different language from the last one -- seventeen thousand rows re-read and
// search.ts's row keys rebuilt with them.
const cacheKey = Symbol.for("spoken.quests-catalogue.by-lang");
const indexKey = Symbol.for("spoken.quests-line-index.by-lang");

/**
 * Every line, rebuilt only when the tables have moved.
 *
 * The same object every time until the stamp moves, not a fresh wrapper: search.ts keys its
 * row keys on the corpus's identity, and a new wrapper per call rebuilt them all on every
 * request.
 */
export async function corpus(lang: Lang = BASE_LANG): Promise<Corpus> {
  const stamp = await stampOf(lang);
  return memoByLang(cacheKey, lang, stamp, async () => ({ lines: await build(lang) }));
}

/**
 * lineId -> every row carrying it, which is not one row: a gossip line is a hash of its
 * text, so one id can name a dozen speakers, and 103 ids name two different lines.
 *
 * Tied to the identity of the array it was built from rather than to the stamp, so it
 * rebuilds exactly when the catalogue does and a test passing its own lines is never
 * answered from another's.
 */
export async function lineIndex(lang: Lang = BASE_LANG): Promise<Map<string, CorpusLine[]>> {
  const lines = (await corpus(lang)).lines;
  return memoByLang(indexKey, lang, lines, () => {
    const index = new Map<string, CorpusLine[]>();
    for (const line of lines) {
      const group = index.get(line.lineId);
      if (group) group.push(line);
      else index.set(line.lineId, [line]);
    }
    return index;
  });
}

/**
 * The flavor to give a race-gender the game data does not answer for -- an NPC resolved only
 * from the model file id the addon reported, which names a race and a gender but never a
 * flavor.
 *
 * Mirrors pipelines/quests/tts_cli/flavors.py's fallback_flavors exactly: "standard" where
 * that race-gender has any corpus lines carrying it, otherwise its busiest flavor. Never a
 * constant -- four race-genders (dwarf-female, goblin-female, goblin-male, tauren-male) have
 * no standard voice in the game at all, so a constant would point at nothing for them.
 *
 * A race-gender the corpus carries no flavored line for at all (not merely no "standard" one)
 * answers null, not a guess: there is nothing in the data to derive a busiest flavor from, and
 * the row this feeds is unconfirmed regardless.
 */
export async function defaultFlavorFor(race: string, gender: string): Promise<string | null> {
  // A race-gender the corpus has no flavored line for yet falls back to the roster's first.
  return (
    (await flavorDefaults()).get(`${race}-${gender}`) ??
    (await loadRoster()).flavorsOf(race, gender)[0] ??
    null
  );
}

const flavorTalliesKey = Symbol.for("spoken.quests-flavor-tallies");
type FlavorTalliesHolder = { [flavorTalliesKey]?: { lines: CorpusLine[]; tallies: Map<string, Map<string, number>> } };

// race-gender -> flavor -> how many corpus lines carry it. Shared by flavorDefaults and
// flavorsFor, which ask the identical question of the identical data, and tied to the
// catalogue's own array so it re-tallies exactly when the tables move.
async function flavorTallies(): Promise<Map<string, Map<string, number>>> {
  const lines = (await corpus()).lines;
  const holder = globalThis as FlavorTalliesHolder;
  if (!holder[flavorTalliesKey] || holder[flavorTalliesKey].lines !== lines) {
    const counts = new Map<string, Map<string, number>>();
    for (const line of lines) {
      if (!line.flavor) continue;
      const raceGender = `${line.race}-${line.gender}`;
      const tally = counts.get(raceGender) ?? new Map<string, number>();
      tally.set(line.flavor, (tally.get(line.flavor) ?? 0) + 1);
      counts.set(raceGender, tally);
    }
    holder[flavorTalliesKey] = { lines, tallies: counts };
  }
  return holder[flavorTalliesKey].tallies;
}

const flavorDefaultsKey = Symbol.for("spoken.quests-default-flavors");
type FlavorDefaultsHolder = { [flavorDefaultsKey]?: { lines: CorpusLine[]; defaults: Map<string, string> } };

// Tied to the catalogue's own array, as lineIndex is, so it re-tallies exactly when the tables
// move and never otherwise.
async function flavorDefaults(): Promise<Map<string, string>> {
  const lines = (await corpus()).lines;
  const holder = globalThis as FlavorDefaultsHolder;
  if (!holder[flavorDefaultsKey] || holder[flavorDefaultsKey].lines !== lines) {
    const counts = await flavorTallies();
    const defaults = new Map<string, string>();
    for (const [raceGender, tally] of counts) {
      if (tally.has("standard")) {
        defaults.set(raceGender, "standard");
        continue;
      }
      // Busiest first, then name, so a tie does not depend on Map iteration order --
      // fallback_flavors' own tie-break, kept identical so the two sides never disagree.
      const [flavor] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      defaults.set(raceGender, flavor);
    }
    holder[flavorDefaultsKey] = { lines, defaults };
  }
  return holder[flavorDefaultsKey].defaults;
}
