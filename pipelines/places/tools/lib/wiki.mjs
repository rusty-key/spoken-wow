// Shared warcraft.wiki.gg fetching, era filtering and Lua emission.
// Used by tools/scrape.mjs (zones) and tools/scrape-subzones.mjs (subzones).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loreSections } from "./sections.mjs";

// The monorepo root, four levels up from pipelines/places/tools/lib/. See loredata.mjs
// for why this reaches the repo root rather than the pipeline root.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const CACHE = join(ROOT, "pipelines/places/tools/cache");

export const API = "https://warcraft.wiki.gg/api.php";
export const WIKI = "https://warcraft.wiki.gg/wiki/";
export const USER_AGENT =
  "SpokenPlaces-addon-build/0.1 (WoW Classic Era addon; +https://warcraft.wiki.gg/wiki/Special:MyPage)";
export const THROTTLE_MS = 500;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//------------------------------------------------------------------------------
// Era filtering
//
// Wiki articles narrate a place across every expansion, so a Classic Era addon
// would otherwise describe Deathwing and Pandaria. Markers are matched per
// sentence (see cleanExtract).
//
// Deliberately NOT markers, because vanilla lore uses them legitimately:
//   Draenor, Burning Legion, Northrend, Lich King, Scourge, Naxxramas,
//   Third War, Dark Portal, Grom Hellscream, lower-case "dragonflight".
//------------------------------------------------------------------------------

export const POST_VANILLA = [
  // Case-insensitive: the wiki also writes "until the cataclysm, the huge lake
  // ..." in lower case, and in Era that lake is still full of water. A rare
  // false positive on a Sundering reference is cheaper than wrong-era geography;
  // use overrides.json if one shows up.
  /\bcataclysm\b/i,
  /\bthe [Ss]hattering\b/,
  /\bDeathwing\b/,
  /\bGarrosh\b/,
  /\bVol'jin\b/,
  /\b[Tt]he Burning Crusade\b/,
  /\bOutland\b/,
  /\bWrath of the Lich King\b/,
  /\bIcecrown Citadel\b/,
  /\bMists of Pandaria\b/,
  /\bPandaria\b/,
  /\bpandaren\b/i,
  /\bWarlords of Draenor\b/,
  /\bBroken Isles\b/,
  /\bArgus\b/,
  /\bBattle for Azeroth\b/,
  /\bAzerite\b/,
  /\bN'Zoth\b/,
  /\bFourth War\b/,
  /\bSiege of Orgrimmar\b/,
  // Battle for Azeroth and Shadowlands respectively. Both name events rather than
  // expansions, so nothing above catches them, and both were reaching the corpus:
  // eleven shipped lines described Tirisfal and Lordaeron as they stand *after* a
  // war that has not happened in Era.
  /\bBattle (?:for|of) Lordaeron\b/,
  /\bthe Jailer\b/,
  // From the 2026-08 full-corpus review (dist/review-findings.md): terms with
  // zero legitimate vanilla uses that had leaked into shipped text. Named
  // events, people and places rather than expansions, so nothing above caught
  // them. Deliberately NOT here despite looking post-vanilla: "Zandalari" (the
  // Zandalar Tribe is a vanilla Zul'Gurub faction) and soft markers like
  // Grimtotem, Theramore, Dalaran, Sargeras -- vanilla vocabulary whose later
  // fate is the leak; blocking the word would cut legitimate lore.
  /\bWar of the Thorns\b/,
  /\bBilgewater\b/,
  /\bsaronite\b/i,
  /\bVanessa VanCleef\b/,
  /\bDelaryn Summermoon\b/,
  /\bAlennah Starsong\b/,
  /\bLorash Sunbeam\b/,
  /\bSira Moonwarden\b/,
  /\bPrimalists?\b/,
  /\bTwilight Highlands\b/,
  /\bwarfronts?\b/i,
  /\bHorde Council\b/,
  /\bXenedar\b/,
  /\bFirelands\b/,
  /\bShadowlands\b/,
  /\bDragonflight\b/,
  /\bDragon Isles\b/,
  /\b[Tt]he War Within\b/,
  /\bWorld of Warcraft:\s/,
  /\bpatch \d+\.\d+/i,
  // Quest phasing arrived in Wrath/Cataclysm; subzone articles use it to
  // describe post-vanilla quest hubs that do not exist in Era.
  /\bphas(?:ed|ing)\b/i,
  /^(?:After|Following|During|Since)\s+the\s+(?:Cataclysm|Shattering|Fourth War)/,
];

// "Legion" needs its own pass: vanilla lore references the Burning Legion
// constantly, so only the expansion-name reading counts as post-vanilla.
const LEGION_EXPANSION =
  /\b(?:the\s+)?Legion\s+(?:expansion|invasion of Azeroth)\b|\bWorld of Warcraft: Legion\b/;

export function isPostVanilla(text) {
  for (const re of POST_VANILLA) {
    if (re.test(text)) return re.source;
  }
  if (LEGION_EXPANSION.test(text)) return LEGION_EXPANSION.source;
  return null;
}

//------------------------------------------------------------------------------
// Text cleanup
//------------------------------------------------------------------------------

export function normalise(text) {
  return text
    // Pronunciation guides read as line noise in-game: "Tanaris (/təˈnɛə.ɹɪs/
    // tə-NAYR-iss or ...) is a desert" -> "Tanaris is a desert".
    .replace(/\s*\(\s*\/[^)]*\)/g, "")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/—/g, " -- ")
    .replace(/–/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\[\d+\]/g, "") // reference markers
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function splitSentences(paragraph) {
  // Split on sentence punctuation followed by an opening-looking token. Good
  // enough for encyclopedic prose; keeps "e.g." and "Mt. Hyjal" intact.
  return paragraph.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
}

// Filter per sentence, not per paragraph. Many wiki intros are a single
// paragraph that is mostly timeless description with one clause about a later
// expansion -- dropping the whole paragraph loses good vanilla lore, and keeping
// it shows players Cataclysm content.
export function cleanExtract(raw, { eraFilter = true, verbose = false } = {}) {
  const paragraphs = raw
    .split(/\n+/)
    .map((p) => normalise(p))
    // Section headings survive explaintext as bare "== Foo ==" lines.
    .filter((p) => p.length > 0 && !/^=+.*=+$/.test(p));

  const keptParagraphs = [];
  const dropped = [];

  for (const p of paragraphs) {
    if (!eraFilter) {
      keptParagraphs.push(p);
      continue;
    }

    const keptSentences = [];
    for (const sentence of splitSentences(p)) {
      const reason = isPostVanilla(sentence);
      if (reason) {
        dropped.push({ text: sentence, reason });
      } else {
        keptSentences.push(sentence);
      }
    }

    if (keptSentences.length > 0) {
      keptParagraphs.push(keptSentences.join(" "));
    }
  }

  if (verbose && dropped.length > 0) {
    for (const d of dropped) {
      console.log(`    drop [${d.reason}] ${d.text.slice(0, 80)}...`);
    }
  }

  return {
    full: keptParagraphs.join("\n\n"),
    droppedCount: dropped.length,
    empty: keptParagraphs.length === 0 && paragraphs.length > 0,
  };
}

// First one or two sentences, for hover previews and list summaries.
export function makeShort(full, limit = 220) {
  const firstPara = full.split("\n\n")[0] || "";
  const sentences = splitSentences(firstPara);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > limit) break;
    out = out ? out + " " + s : s;
    if (out.length >= limit * 0.6) break;
  }
  if (!out) out = firstPara.slice(0, limit);
  return out.trim();
}

//------------------------------------------------------------------------------
// Lookup-key normalisation
//
// Subzone lore is keyed by name because MapUtil.FindBestAreaNameAtMouse returns
// a name, not an ID. Client and wiki disagree on cosmetic details -- the wiki
// titles a page "Bulwark" while the client reports "The Bulwark" -- so both
// sides are reduced to the same canonical form.
//------------------------------------------------------------------------------

export function normaliseKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

//------------------------------------------------------------------------------
// Fetching
//------------------------------------------------------------------------------

function cachePath(key) {
  return join(CACHE, encodeURIComponent(key) + ".json");
}

// Fetch any API query with on-disk caching. `key` names the cache entry.
async function cachedQuery(query, key, { refresh = false } = {}) {
  const path = cachePath(key);
  if (!refresh && existsSync(path)) {
    return { json: JSON.parse(await readFile(path, "utf8")), cached: true };
  }

  const res = await fetch(`${API}?${query}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
  const json = await res.json();

  await mkdir(CACHE, { recursive: true });
  await writeFile(path, JSON.stringify(json, null, 2));
  await sleep(THROTTLE_MS);
  return { json, cached: false };
}

export async function fetchExtract(title, opts = {}) {
  const query =
    `action=query&format=json&formatversion=2&redirects=1` +
    `&prop=extracts&explaintext=1&exintro=1&titles=${encodeURIComponent(title)}`;
  return cachedQuery(query, title, opts);
}

// The whole article as plain text, headings included. Used only when a page's
// lead is too thin to be worth showing -- Elwynn Forest (Classic) leads with the
// single sentence "Elwynn Forest is the starting zone for playable humans." and
// keeps the actual description under == Geography ==.
export async function fetchFullExtract(title, opts = {}) {
  const query =
    `action=query&format=json&formatversion=2&redirects=1` +
    `&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}`;
  return cachedQuery(query, `${title}#full`, opts);
}

// Which headings count as lore now lives in lib/sections.mjs, shared with the
// rewrite pipeline. Re-exported because the scrapers import it from here.
export { splitSections, loreSections, LORE_SECTIONS } from "./sections.mjs";

// Lead section plus any lore-bearing sections, capped at maxChars on a paragraph
// boundary so the panel never gets a wall of text.
export function buildFromSections(plaintext, { maxChars = 2200 } = {}) {
  const { lead, kept } = loreSections(plaintext);
  const parts = [lead, ...kept.map((s) => s.text)].filter(Boolean);
  return capParagraphs(parts.flatMap((part) => part.split(/\n+/)).map((p) => p.trim()).filter(Boolean), maxChars);
}

// The paragraphs joined by blank lines, as many from the first as fit in maxChars (the first always).
export function capParagraphs(paragraphs, maxChars) {
  let out = "";
  for (const para of paragraphs) {
    if (out && out.length + para.length + 2 > maxChars) break;
    out = out ? out + "\n\n" + para : para;
  }
  return out;
}

// The titles a creature's article may have, most likely first.
export const creatureTitles = (name) => [name, `${name} (boss)`, `${name} (NPC)`];

// Whether an article is a disambiguation page, from its opening.
export const isDisambiguation = (text) => /may refer to|can refer to|disambiguation/i.test(text.slice(0, 300));

// All page members of a category, following continuation.
export async function fetchCategoryMembers(category, opts = {}) {
  const members = [];
  let cont = null;
  let page = 0;

  do {
    // cmnamespace=0 restricts to article space. cmtype=page alone still lets
    // through project and talk pages that have been miscategorised on the wiki
    // (e.g. "Warcraft Wiki talk:Village pump/Archive11" sits in a subzone
    // category). The cache key carries the namespace so old cached responses
    // from before this restriction are not reused.
    const query =
      `action=query&format=json&formatversion=2&list=categorymembers&cmtype=page` +
      `&cmnamespace=0&cmlimit=500&cmtitle=${encodeURIComponent("Category:" + category)}` +
      (cont ? `&cmcontinue=${encodeURIComponent(cont)}` : "");
    const { json } = await cachedQuery(query, `category-ns0-${category}-${page}`, opts);
    for (const m of json?.query?.categorymembers || []) {
      members.push(m.title);
    }
    cont = json?.continue?.cmcontinue || null;
    page++;
  } while (cont);

  return members;
}

//------------------------------------------------------------------------------
// Classic-specific pages
//
// The wiki keeps separate articles for places whose description changed after
// vanilla, titled "<Name> (Classic)". These are written about the 1.x world, so
// they are natively era-correct rather than filtered down from an
// all-expansions article -- Darkshore (Classic) still describes the port of
// Auberdine, which Cataclysm destroyed. 39 of the 46 Era zone maps have one.
//
// The era filter still runs over them as a safety net; it earns its keep on a
// few pages (Blasted Lands (Classic) has one post-vanilla sentence).
//------------------------------------------------------------------------------

export async function fetchClassicTitleIndex(opts = {}) {
  const titles = new Set();
  for (const category of ["Classic zones", "Classic subzones"]) {
    for (const title of await fetchCategoryMembers(category, opts)) {
      if (/ \(Classic\)$/.test(title)) titles.add(title);
    }
  }
  return titles;
}

// Returns the "(Classic)" title for a place, or null if the wiki has none.
// The wiki drops a leading article: "The Barrens" -> "Barrens (Classic)".
export function classicVariant(name, index) {
  if (!index || index.size === 0) return null;
  const candidates = [
    `${name} (Classic)`,
    `${name.replace(/^The\s+/, "")} (Classic)`,
  ];
  return candidates.find((c) => index.has(c)) || null;
}

// "Durotar (Classic)" -> "Durotar", for display and lookup keys.
export function stripClassicSuffix(title) {
  return title.replace(/\s*\(Classic\)$/, "");
}

// Fetch a page's lore text: the lead section, or -- when the lead is too thin to
// be worth showing -- the lore-bearing sections of the full article. Returns null
// when the page has no usable text at all.
//
// Counters are reported back so callers can log cache behaviour.
export async function fetchLoreText(title, opts = {}) {
  const { refresh = false, minChars = 300, eraFilter = true, verbose = false } = opts;

  const res = await fetchExtract(title, { refresh });
  const found = extractFromResponse(res.json, title);
  if (!found) {
    return { missing: true, fetches: res.cached ? 0 : 1, cacheHits: res.cached ? 1 : 0 };
  }

  let cleaned = cleanExtract(found.text, { eraFilter, verbose });
  let usedSections = false;
  let fetches = res.cached ? 0 : 1;
  let cacheHits = res.cached ? 1 : 0;

  if (cleaned.full.length < minChars) {
    const fullRes = await fetchFullExtract(title, { refresh });
    fullRes.cached ? cacheHits++ : fetches++;
    const fullFound = extractFromResponse(fullRes.json, title);
    if (fullFound) {
      const fromSections = cleanExtract(buildFromSections(fullFound.text), {
        eraFilter,
        verbose,
      });
      if (fromSections.full.length > cleaned.full.length) {
        cleaned = fromSections;
        usedSections = true;
      }
    }
  }

  return {
    missing: false,
    cleaned,
    usedSections,
    resolvedTitle: found.resolvedTitle,
    fetches,
    cacheHits,
  };
}

export function extractFromResponse(json, title) {
  const pages = json?.query?.pages;
  if (!pages) return null;
  const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
  if (!page || page.missing) return null;
  const text = page.extract;
  if (!text || !text.trim()) return null;
  return { text, resolvedTitle: page.title || title };
}

export function sourceUrl(title) {
  return WIKI + encodeURIComponent(title.replace(/ /g, "_"));
}

//------------------------------------------------------------------------------
// Lua emission
//------------------------------------------------------------------------------

export function luaString(s) {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n")
      // Strip control characters rather than emitting raw bytes into Lua source.
      .replace(/[\x00-\x1f]/g, " ") +
    '"'
  );
}

// Strip the `_comment` documentation keys used in the seed files.
export function withoutComments(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonIfExists(path) {
  return existsSync(path) ? readJson(path) : {};
}
