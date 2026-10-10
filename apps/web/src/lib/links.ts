import type { Source } from "@/lib/sections";
/**
 * Where one page sends you to another.
 *
 * Here rather than inline at each call site because these are the links the merge broke:
 * the quests explorer used to be the site root, so /issues and /lexicon both pointed at
 * `/?q=…`, and after the move that address is the landing page - which renders, shows two
 * links and no results, and reports no error at all. A dead deep link that still returns
 * 200 is the kind a build cannot catch, so the addresses live in one tested module.
 */

/** Which field a free-text query is matched against. Mirrors LineFilters["filter"]. */
type Scope = "any" | "npc" | "quest" | "text";

/** Mirrors zones' PageFilters["field"], and books' - two different sets under one name. */
type ZoneScope = "any" | "name" | "zone" | "text";
type BookScope = "any" | "title" | "text";

/**
 * The quests explorer, narrowed.
 *
 * `finding` is an issue id, and it is the filter that matters: a text search cannot say
 * what such a link means, since the bare `--` finding and `Hearthglen--you'll` are two
 * findings whose text both contains `--`. `q` is what the search box then shows, so the
 * page says what it is showing rather than presenting a narrowed list with an empty box.
 */
export function questsHref(options: { q?: string; filter?: Scope; finding?: number }): string {
  const params = new URLSearchParams();
  if (options.finding !== undefined) params.set("finding", String(options.finding));
  if (options.q !== undefined) params.set("q", options.q);
  if (options.filter !== undefined) params.set("filter", options.filter);
  return params.size ? `/quests?${params}` : "/quests";
}

/**
 * The zones explorer, narrowed to one zone or to a search.
 *
 * `field` is this section's name for what quests calls `filter`: three filter vocabularies,
 * three modules, and a link that used the other section's param name would render the whole
 * corpus and report no error at all.
 */
export function zonesHref(options: { q?: string; mapID?: number; field?: ZoneScope } = {}): string {
  const params = new URLSearchParams();
  if (options.mapID !== undefined) params.set("zone", String(options.mapID));
  if (options.q !== undefined) params.set("q", options.q);
  if (options.field !== undefined) params.set("field", options.field);
  return params.size ? `/zones?${params}` : "/zones";
}

/** The books explorer, narrowed. `field` as in zonesHref: books says `field` too. */
export function booksHref(options: { q?: string; field?: BookScope } = {}): string {
  const params = new URLSearchParams();
  if (options.q !== undefined) params.set("q", options.q);
  if (options.field !== undefined) params.set("field", options.field);
  return params.size ? `/books?${params}` : "/books";
}

/**
 * The page a reporter saw when they filed, for a report that carries an address.
 *
 * NOT the explorer with the line id in the search box, which is what this table used to
 * link to and which finds nothing: neither section's search matches an id. Quests matches
 * NPC names, quest titles, text and bare numbers; zones matches names, zones and text. The
 * landing page is the better destination anyway - it is the line, its audio and the report
 * form, which is what a triager wants to see.
 *
 * `target` is stored as the addon produced it: 'quest/84/accept' or 'npc/5678' for quests,
 * '<mapID>/<slug>' for zones, and a bare page id for books. All three are already
 * path-shaped, and each section's route takes exactly its own shape.
 */
export function reportHref(source: Source, target: string): string {
  return `/${source}/r/${target.split("/").map(encodeURIComponent).join("/")}`;
}

/** The lexicon editor, with this name already filled in. */
export function lexiconHref(grapheme: string): string {
  return `/lexicon?${new URLSearchParams({ grapheme })}`;
}

/**
 * An explorer, narrowed to one line.
 *
 * The triage counterpart of reportHref, and deliberately not it: a report's address sends a
 * *player* to the page they filed from, while a triager wants the line in the explorer, with
 * the audio, the text and the controls that can fix it. One param name across all three
 * sections, because the report table cannot know which filter vocabulary it is addressing.
 *
 * A quests lineId is not unique - a gossip id is a hash of the text, so every NPC of that
 * race and gender saying it shares one - and the filter is honest about that: the link lands
 * on every line carrying the id, which is the set the report is about.
 */
export function explorerHref(source: Source, lineId: string): string {
  // Gossip shares the quests corpus and takes but has its own explorer, and its ids are the
  // only ones starting `g:` (tts_cli/naming.py).
  const path = source === "quests" && lineId.startsWith("g:") ? "gossip" : source;
  return `/${path}?${new URLSearchParams({ line: lineId })}`;
}

/**
 * An explorer, narrowed to everything a report's address covers.
 *
 * The middle case between explorerHref and reportHref. A report carries no lineId when the
 * address resolved to more than one line and the reporter never picked one - a gossip NPC
 * with a dozen takes is the common shape - and linking such a report to the `/r/` page sent
 * the triager to the player's form rather than to the lines. The address still says which
 * lines it means, so the explorer can be narrowed by it even with no id to filter on.
 *
 * Null when the address names nothing an explorer can filter by, and the caller falls back
 * to reportHref: a books target is a bare page id, and neither books search field matches
 * ids.
 */
export function targetExplorerHref(source: Source, target: string): string | null {
  const segments = target.split("/");

  if (source === "quests") {
    // The two shapes lib/reports/target.ts parses. A bare number is an id lookup in quests
    // search, so the id goes in `q` with the filter that says which id it is.
    // An NPC address is how gossip travels, so it opens the gossip explorer. A follow-up
    // travels the same way and is in the quests one, which this link does not show.
    if (segments[0] === "npc" && segments.length === 2 && /^\d+$/.test(segments[1])) {
      return `/gossip?${new URLSearchParams({ q: segments[1], filter: "npc" })}`;
    }
    if (segments[0] === "quest" && segments.length === 3 && /^\d+$/.test(segments[1])) {
      return questsHref({ q: segments[1], filter: "quest" });
    }
    return null;
  }

  if (source === "zones") {
    // '<mapID>/<slug>': the zone filter takes the id, and the slug is the page within it,
    // which no filter addresses.
    if (segments.length === 2 && /^\d+$/.test(segments[0])) {
      return zonesHref({ mapID: Number(segments[0]) });
    }
    return null;
  }

  return null;
}
