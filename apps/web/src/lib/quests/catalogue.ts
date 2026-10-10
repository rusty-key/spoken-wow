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
import { npcKey, type Corpus, type CorpusLine } from "@/lib/corpus";
import { answersQuestMomentSql } from "@/lib/contributions/naming";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { flavorsOf } from "@/lib/voices/voices";


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

/** Speakers have no live flag, so their max id and count are the whole stamp. */
function speakerStamp(where: string): string {
  return `(select coalesce(max("id"), 0) || ':' || count(*) from "quest_line_speaker" where ${where})`;
}

async function stampOf(lang: Lang): Promise<string> {
  const english = `${versionStamp("quest_line", `"lang" = '${BASE_LANG}'`)} || '/' ||
    ${speakerStamp(`"lang" = '${BASE_LANG}'`)}`;
  // Another language is read over the English lines and speakers, so its memo moves when
  // they do as well as when its own text, speakers or names do -- one statement either way.
  const rows = await query<{ stamp: string }>(
    lang === BASE_LANG
      ? `select ${english} as "stamp"`
      : `select ${english} || '|' || ${versionStamp("quest_line", `"lang" = $1`)} || '/' ||
                ${speakerStamp(`"lang" = $1`)} || '/' ||
                ${nameStamp(["quest", "creature", "gameobject", "item"])} as "stamp"`,
    lang === BASE_LANG ? [] : [lang],
  );
  return rows[0]?.stamp ?? "";
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
  voice: string;
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
            s."npcId", s."npcName", s."npcType", s."race", s."gender", s."flavor", s."voice",
            l."playerGender", l."text", l."originalText", l."fileName",
            l."generatable", l."skipReason", s."contributionId"
       from "quest_line_speaker" s
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = s."lang" and l."isCurrent"
      where s."lang" = $1
      order by s."ord"`,
    [lang],
  );

  if (rows.length === 0) throw new CorpusEmpty(lang);

  return rows.map((row) => ({
    ...row,
    npcType: row.npcType as CorpusLine["npcType"],
    source: row.source as CorpusLine["source"],
    playerGender: row.playerGender as CorpusLine["playerGender"],
  }));
}

/**
 * Another language's lines: every English line, with this language's text and names where
 * it has them, then the lines only this language has.
 *
 * THE ENGLISH LINES ARE THE SKELETON because they are what exists: which lines the game
 * has, who speaks each, what file each is voiced into. None of that differs by language --
 * line ids and file names are derived from the English text, and the speakers are facts
 * about the world -- so a language contributes only what it says and what it calls things.
 *
 * ONE ROW PER LINE ID AND SPEAKER, NOT PER VARIANT. A second English variant is the same
 * quest in another content patch -- kept in English for the addon's title lookup -- and it
 * shares the first's file and, on every line in the corpus, its speakers. A language has one
 * text for it (locale_import.py writes it as variant 0), so a second row would be the same
 * line and the same mp3 listed twice.
 *
 * Where it has not said, the English stands in and `missing` says so. That is a rendering,
 * never a row: nothing here is written back, exported or voiced. A line whose text is
 * missing is not generatable, so the English cannot be recorded under the language's name.
 *
 * A LINE ENGLISH DOES NOT HAVE is read from this language's own speakers, which only such a
 * line has, and carries no `english`. Once English has the moment its line and speakers are
 * the skeleton again, and this language's row is its translation: same id, same file.
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
    `select l."lineId", l."variant", l."source", l."questId",
            coalesce(qn."name", l."questTitle") as "questTitle",
            s."npcId", coalesce(nn."name", s."npcName") as "npcName", s."npcType",
            s."race", s."gender", s."flavor", s."voice",
            l."playerGender", coalesce(t."text", l."text") as "text",
            l."originalText", l."fileName",
            coalesce(t."generatable", false) as "generatable",
            case when t."id" is null then 'untranslated' else t."skipReason" end as "skipReason",
            s."contributionId",
            t."id" is null as "textMissing",
            l."questId" is not null and qn."id" is null as "titleMissing",
            nn."id" is null as "nameMissing",
            s."lang" <> '${BASE_LANG}' as "native",
            l."questTitle" as "englishTitle", s."npcName" as "englishName"
       from "quest_line_speaker" s
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = s."lang" and l."isCurrent"
       left join "quest_line" t
         on t."lineId" = l."lineId" and t."variant" = l."variant"
        and t."lang" = $1 and t."isCurrent"
       left join "entity_name" qn
         on qn."kind" = 'quest' and qn."entityId" = l."questId"::text
        and qn."lang" = $1 and qn."isCurrent"
       left join "entity_name" nn
         on nn."kind" = s."npcType" and nn."entityId" = s."npcId"::text
        and nn."lang" = $1 and nn."isCurrent"
      where s."variant" = 0
        and (s."lang" = '${BASE_LANG}'
             or (s."lang" = $1
                 and not exists (select 1 from "quest_line" e
                                  where e."lang" = '${BASE_LANG}' and e."isCurrent"
                                    and ${answersQuestMomentSql(`e."lineId"`, `s."lineId"`)})))
      order by s."lang" <> '${BASE_LANG}', s."ord"`,
    [lang],
  );

  if (rows.length === 0) throw new CorpusEmpty();

  return rows.map((raw) => {
    const { textMissing, titleMissing, nameMissing, native, englishTitle, englishName, ...row } = raw;
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
 * What the corpus already knows about an NPC, or null for one it has never carried.
 *
 * The corpus is the exact answer where it has one: it was built from the same display data the
 * game uses, including the flavor that no client API exposes.
 *
 * A linear scan, not a new memoised index: lineIndex groups by lineId, and one lineId is shared
 * by every NPC with the same gossip line, so it cannot answer "what does this one NPC carry"
 * without a second index carrying its own cache-invalidation story alongside it. This runs once
 * per contribution resolved, not per request, so the scan is the honest cost here.
 *
 * Extracted speakers only. The catalogue also carries the speakers of accepted contributions,
 * and those were written from this NPC's own resolution at the time -- often an unconfirmed
 * model guess. Reading one back as "the corpus" confirmed the guess and let it outrank every
 * later, better answer: 50 Forever NPCs whose appearances name an exact voice were stuck on
 * the default flavor that way.
 */
export async function npcVoiceFromCorpus(
  npcType: string,
  npcId: number,
): Promise<{ race: string; gender: string; flavor: string | null; npcName: string } | null> {
  const wanted = `${npcType}:${npcId}`;
  for (const line of (await corpus()).lines) {
    if (line.contributionId === null && npcKey(line) === wanted) {
      return { race: line.race, gender: line.gender, flavor: line.flavor, npcName: line.npcName };
    }
  }
  return null;
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
  // A race-gender the corpus has no flavored line for yet falls back to the roster's first
  // flavor for it, which voices.ts lists busiest first where the corpus cannot say.
  return (await flavorDefaults()).get(`${race}-${gender}`) ?? flavorsOf(race, gender)[0] ?? null;
}

/**
 * Every flavor a race-gender's voice actually has, for the triage table's flavor picker.
 *
 * A moderator confirming a client-provenance row (race and gender known, flavor only guessed)
 * must be offered exactly the voice sets tts_cli can generate for that race-gender -- goblin
 * female has only "zany"; tauren male has no "standard" at all (defaultFlavorFor's own flagship
 * case) but does have elder/shaman/warrior. Anything wider would let a moderator pick a voice
 * name that produces no file.
 */
export async function flavorsFor(race: string, gender: string): Promise<string[]> {
  // The roster, not the corpus, so a race-gender offers its voice sets before its first line.
  return flavorsOf(race, gender).sort((a, b) => a.localeCompare(b));
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
