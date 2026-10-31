/**
 * The bridge to pipelines/places/tools.
 *
 * Every import that crosses out of this app goes through this one file, so the blast radius
 * of the boundary is one module rather than scattered `../../../../pipelines/...` specifiers.
 * next.config.ts sets outputFileTracingRoot to the repo root, without which Next traces
 * dependencies from apps/web alone and leaves all of this out of the build.
 *
 * WHY IMPORT RATHER THAN SHELL OUT. Spawning `node tools/voice/generate.mjs` would have kept
 * the boundary clean and cost the two things that matter: the typed failure kinds from
 * elevenlabs.mjs (quota vs auth vs rate-limit, which decide whether the rest of a batch is
 * worth attempting) and the character-cost header, which is the only authoritative record of
 * what a line was billed. Parsing those back out of stdout is how the CLI and the app start
 * disagreeing.
 *
 * These modules are dependency-free ESM with no build step. TypeScript reads them with
 * allowJs and infers their shapes; the `as` casts below are the one place those inferred
 * shapes are pinned to what this app relies on, so a change in pipelines/places shows up as a
 * type error here rather than as undefined at runtime.
 *
 * WHAT IS DELIBERATELY NOT HERE, and was on the zones site:
 *
 *   loadConfig / saveConfig / draftConfig / resolveVoiceId
 *     The narrator's voice, model and settings came from tools/voice/config.json. They come
 *     from the database now, shared with the quests side: the roster on /voices, the model
 *     and voice settings from the generating collaborator's own generation_preference, the
 *     dictionary from pronunciation_lexicon.
 *     config.json is down to a fallback credit rate for the reporting CLI.
 *
 *   synthesize / verifyKey / fetchTier / listVoices / apiKey
 *     Every request to ElevenLabs is the site's, through lib/generation/tts.ts and
 *     lib/voices/elevenlabs.ts, with a key belonging to the signed-in user rather than to
 *     the machine. The pipeline does no generating and holds no client.
 *
 *   Limiter / afterRateLimit / budgetFor's caller
 *     Concurrency is the shared queue's, in lib/generation/concurrency.ts. Two answers to
 *     "how many at once" against one ElevenLabs plan is one too many.
 */
import "server-only";

import * as storeModule from "@tools/voice/store.mjs";
import * as normaliseModule from "@tools/voice/normalise.mjs";
import * as namingModule from "@tools/voice/naming.mjs";
import * as wikiModule from "@tools/lib/wiki.mjs";

// buildCatalogue() is deliberately NOT re-exported. It reads the committed Lua, which is an
// export of lore_line and therefore at best as fresh as the table; the app builds its
// catalogue from the table itself. The CLI keeps it: tools/ must run without a database.

/** Assigns every entry its audio path, resolving slug collisions. Returns lineId -> file. */
export const assignFiles = namingModule.assignFiles as (
  entries: Array<{ mapID: number; key: string | null }>,
) => Map<string, string>;

/** The id assignFiles keys its result by: 's:{mapID}:{key}', or 'z:{mapID}' with no key. */
export const lineIdFor = namingModule.lineId as (entry: { mapID: number; key: string | null }) => string;

export const textHash = namingModule.textHash as (spoken: string) => string;

/** The file-safe form of a canonical subzone key. Round-trips with `normaliseKey` below. */
export const slugFor = namingModule.slugFor as (key: string) => string;

/**
 * A display name reduced to the canonical key the corpus stores -- lower-cased, apostrophes
 * stripped, a leading "the" dropped (WoW subzones are full of "The Underbog"-style names).
 * The scraper runs this on the wiki's name before ever writing a "key" column, so anything
 * that needs to line up with that column, such as a contribution's raw subzone text, has to
 * run it too rather than approximate it.
 */
export const normaliseKey = wikiModule.normaliseKey as (name: string) => string;

// Functions rather than constants: each reads an environment override the droplet sets,
// and a path resolved at import would be fixed before the process had one.
export const historyDir = storeModule.historyDir as () => string;

export const toSpokenText = normaliseModule.toSpokenText as (
  text: string,
  rules: Record<string, string>,
) => string;
export const loadPronunciation = normaliseModule.loadPronunciation as () => Promise<
  Record<string, string>
>;

// The summary shown in list views, derived from the full text. Shared with the scrapers
// rather than reimplemented here, so a line edited in the explorer and a line scraped from
// the wiki get the same summary from the same prose.
export const makeShort = wikiModule.makeShort as (full: string, limit?: number) => string;

export const durationOf = storeModule.durationOf as (path: string) => Promise<number>;

