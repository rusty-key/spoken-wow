// The boss catalogue, built from boss_instance, boss, boss_line and entity_name.
//
// SERVER ONLY. The tables are the corpus; addons/Spoken_Bosses/Data is an export of them, so the
// site never reads it.
//
// A language's catalogue is that language's rows and nothing else. Every live boss is listed in
// every language, because the structure is the same everywhere; its story is the language's own
// current boss_line row or null. English never stands in for a missing story: a German page
// showing English text would read as a German story, and voicing it would cut English audio
// into the German pack. Only a name falls back to English, since a boss with no name cannot be
// listed at all.

import "server-only";

import { query } from "@/lib/db";
import { memoByLang } from "@/lib/memo";
import { versionStamp } from "@/lib/stamp";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { EMPTY_CONTEXT, sectionContext, type SearchContext, type Take } from "@/lib/places/catalogue";
import { assignFiles, lineIdFor, loadPronunciation, textHash, toSpokenText } from "@/lib/places/tools";

import { bossLineId } from "./story";

export { EMPTY_CONTEXT, type SearchContext, type Take };

export type BossEntry = {
  /** boss:{map}:{key}, the addon's clip key. */
  id: string;
  bossId: number;
  map: number;
  key: string;
  name: string;
  instanceName: string;
  kind: "dungeon" | "world";
  /** The zone the boss stands in: its own for a world boss, the instance's otherwise. */
  zone: number;
  encounterIds: number[];
  creatureId: number | null;
  /** This language's current story, or null when it has none. */
  text: string | null;
  source: string | null;
  /** What is sent to the voice: null with no story. */
  spoken: string | null;
  /** sha1 of `spoken`, compared against a take's hash; null with no story. */
  hash: string | null;
  /** Store-relative and extension-less, '{map}/{slug}'. The same in every language. */
  file: string;
  /** The language has no name of its own, so `name` is the English. Absent in English. */
  nameMissing?: boolean;
  /** The English name, for a translator. Absent in English. */
  englishName?: string;
};

type StructureRow = {
  bossId: number;
  map: number;
  key: string;
  retired: boolean;
  kind: "dungeon" | "world";
  zone: number;
  encounterIds: number[];
  creatureId: number | null;
};

/**
 * Every boss, retired ones included, in the order files are assigned.
 *
 * The order is load-bearing: assignFiles gives a colliding slug's plain file to whichever entry
 * it reaches first, so this order is what keeps a file where it is from one build to the next.
 * Retired bosses take part so a neighbour retiring never moves a file the pack already ships.
 */
async function structure(): Promise<StructureRow[]> {
  return query<StructureRow>(
    `select b."id" as "bossId", b."map", b."key", b."retired", i."kind",
            coalesce(b."zone", i."zone") as "zone", b."encounterIds", b."creatureId"
       from "boss" b join "boss_instance" i on i."map" = b."map"
      order by i."position", i."map", b."position", b."id"`,
  );
}

/**
 * What one language's catalogue is built from, as one comparable value. A memo validated
 * against the tables rather than dropped by hand, for the two-worker reason
 * lib/places/catalogue.ts gives.
 *
 * boss_line has no id column, so its term is a hash of which versions are current alongside the
 * row count. The structure terms hash every column the catalogue reads, since an intake can
 * rename nothing and still move a position or retire a boss.
 */
async function stampOf(lang: Lang): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select
       (select count(*) || ':' || coalesce(sum(hashtext(
                 "map" || '|' || "kind" || '|' || "zone" || '|' || "position")), 0)
          from "boss_instance") || '|' ||
       (select count(*) || ':' || coalesce(sum(hashtext(
                 "id" || '|' || "map" || '|' || "key" || '|' || "position" || '|' || "retired" || '|' ||
                 coalesce("zone"::text, '') || '|' || coalesce("creatureId"::text, '') || '|' ||
                 "encounterIds"::text)), 0)
          from "boss") || '|' ||
       (select count(*) || ':' || coalesce(sum(hashtext("bossId" || ':' || "version"))
                                     filter (where "isCurrent"), 0)
          from "boss_line" where "lang" = $1) || '|' ||
       ${versionStamp("entity_name", `"kind" in ('boss', 'instance') and "lang" in ($1, '${BASE_LANG}')`)}
       as "stamp"`,
    [lang],
  );
  return rows[0]?.stamp ?? "";
}

type Names = (kind: "boss" | "instance", id: string) => { own?: string; english?: string };

/** Current names of bosses and instances in the language, and in English. */
async function namesOf(lang: Lang): Promise<Names> {
  const rows = await query<{ kind: "boss" | "instance"; entityId: string; lang: string; name: string }>(
    `select "kind", "entityId", "lang", "name" from "entity_name"
      where "kind" in ('boss', 'instance') and "lang" in ($1, $2) and "isCurrent"`,
    [lang, BASE_LANG],
  );
  const own = new Map<string, string>();
  const english = new Map<string, string>();
  for (const row of rows) {
    (row.lang === lang ? own : english).set(`${row.kind}:${row.entityId}`, row.name);
  }
  return (kind, id) => ({ own: own.get(`${kind}:${id}`), english: english.get(`${kind}:${id}`) });
}

async function build(lang: Lang): Promise<BossEntry[]> {
  const [bosses, names, stories, rules] = await Promise.all([
    structure(),
    namesOf(lang),
    query<{ bossId: number; text: string; source: string | null }>(
      `select "bossId", "text", "source" from "boss_line" where "lang" = $1 and "isCurrent"`,
      [lang],
    ),
    // The committed rules are English spellings of English words; another language is spoken
    // with its own lexicon, at generation.
    lang === BASE_LANG ? loadPronunciation() : Promise.resolve({}),
  ]);
  const files = assignFiles(bosses.map((b) => ({ mapID: b.map, key: b.key })));
  const story = new Map(stories.map((row) => [row.bossId, row]));

  return bosses
    .filter((b) => !b.retired)
    .map((b) => {
      const found = story.get(b.bossId);
      const text = found && found.text.trim() !== "" ? found.text : null;
      const spoken = text === null ? null : toSpokenText(text, rules);
      const name = names("boss", String(b.bossId));
      const instance = names("instance", String(b.map));
      return {
        id: bossLineId(b.map, b.key),
        bossId: b.bossId,
        map: b.map,
        key: b.key,
        name: name.own ?? name.english ?? b.key,
        instanceName: instance.own ?? instance.english ?? String(b.map),
        kind: b.kind,
        zone: b.zone,
        encounterIds: b.encounterIds,
        creatureId: b.creatureId,
        text,
        source: text === null ? null : (found?.source ?? null),
        spoken,
        hash: spoken === null ? null : textHash(spoken),
        file: files.get(lineIdFor({ mapID: b.map, key: b.key }))!,
        ...(lang !== BASE_LANG && { nameMissing: name.own === undefined, englishName: name.english ?? b.key }),
      };
    });
}

const catalogueKey = Symbol.for("spoken.bosses-catalogue.by-lang");
const byPathKey = Symbol.for("spoken.bosses-by-path.by-lang");

/** Every live boss, ordered by instance position, then boss position. */
export async function catalogue(lang: Lang = BASE_LANG): Promise<BossEntry[]> {
  return memoByLang(catalogueKey, lang, await stampOf(lang), () => build(lang));
}

export { stampOf as catalogueStamp };

/** A boss by the path its audio file uses, '36/edwin-vancleef'. What /bosses/r/{map}/{slug} resolves. */
export async function lineByPath(map: number, slug: string, lang: Lang = BASE_LANG): Promise<BossEntry | undefined> {
  if (!Number.isInteger(map)) return undefined;
  const entries = await catalogue(lang);
  const byPath = memoByLang(byPathKey, lang, entries, () => new Map(entries.map((e) => [e.file, e])));
  return byPath.get(`${map}/${slug}`);
}

/**
 * Whether a line id names a live boss. Every route that takes a line id from outside asks,
 * since `report` has no foreign key onto boss. Every boss is in every language's catalogue,
 * so English answers for all of them.
 */
export async function isKnownLine(lineId: string): Promise<boolean> {
  return (await catalogue(BASE_LANG)).some((entry) => entry.id === lineId);
}

/** `seesMadeBy`: whether the viewer works in the language. See SearchContext.madeBy. */
export async function loadContext(lang: Lang = BASE_LANG, seesMadeBy = false): Promise<SearchContext> {
  return sectionContext("bosses", lang, seesMadeBy);
}

/** The instance dropdown: each instance's bosses, and how many have a story in the language. */
export type InstanceFacet = { map: number; name: string; count: number; written: number };

export async function instanceFacets(lang: Lang = BASE_LANG): Promise<InstanceFacet[]> {
  const facets = new Map<number, InstanceFacet>();
  for (const entry of await catalogue(lang)) {
    let facet = facets.get(entry.map);
    if (!facet) {
      facet = { map: entry.map, name: entry.instanceName, count: 0, written: 0 };
      facets.set(entry.map, facet);
    }
    facet.count++;
    if (entry.text !== null) facet.written++;
  }
  // In instance position, the order the catalogue is in.
  return [...facets.values()];
}
