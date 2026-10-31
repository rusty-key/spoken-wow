/**
 * The bridge to pipelines/readables/tools.
 *
 * One module for the whole boundary, as lib/places/tools.ts is for the places pipeline, and
 * for the same reason: `../../../../pipelines/...` scattered through the app is a boundary
 * nobody can see. next.config.ts's outputFileTracingRoot is what puts these files in the
 * build at all.
 *
 * WHY IMPORT RATHER THAN REIMPLEMENT. The spoken text and its hash decide what ElevenLabs
 * is sent and whether a take is stale. Written twice -- once in Lua-facing JavaScript and
 * once in TypeScript here -- they drift, and the drift shows up as audio the explorer calls
 * current and the addon never plays.
 */
import "server-only";

import * as textModule from "@readables-tools/lib/text.mjs";
import * as namingModule from "@readables-tools/lib/naming.mjs";

/** What would be sent to a narrator: markup gone, paragraphs flattened. */
export const spokenText = textModule.spokenText as (text: string) => string;

/** The checksum-safe page form: markup gone, paragraph breaks retained, stored entities intact. */
export const normaliseText = textModule.normaliseText as (text: string) => string;

/** The page as the client draws it: layout retained, locale name marker removed, entities decoded. */
export const shownText = textModule.shownText as (text: string) => string;

/**
 * A page in spoken form, its book's title ahead of it unless the page already opens with it.
 * The narration only: the shown text and the addon's checksum stay the page's own words.
 */
export const spokenWithTitle = textModule.spokenWithTitle as (title: string, text: string) => string;

/**
 * Whether a page's text can be voiced, and if not why: empty, a placeholder, or a `$N`-style
 * token the game fills in at runtime and a recording cannot. The extract's own rule, so a
 * page written on the site is judged exactly as one read out of vmangos.
 */
export const isGeneratable = textModule.isGeneratable as (text: string) => {
  generatable: boolean;
  skipReason: string | null;
};

/** sha1 of the spoken text. Compared against a take's hash to spot stale audio. */
export const textHash = namingModule.textHash as (text: string) => string;

/** sha1 of text already in spoken form, newlines and all. What a titled first page is hashed by. */
export const spokenHash = namingModule.spokenHash as (spoken: string) => string;

/** Store-relative and extension-less, e.g. '1381'. AGENTS.md freezes it for extracted pages. */
export const fileFor = namingModule.fileFor as (pageIdOrKey: number | string) => string;

/** '1381' for 'b:1381'; a minted page's 'n{uuid}'. */
export const pageKeyOf = namingModule.pageKeyOf as (lineId: string) => string;

/** The lineId a key names, or null for anything else. */
export const lineIdOfKey = namingModule.lineIdOfKey as (key: string) => string | null;

export const mintPageId = namingModule.mintPageId as () => string;
export const mintBookId = namingModule.mintBookId as () => string;
export const isMinted = namingModule.isMinted as (lineId: string) => boolean;

/** The checksum the addon recomputes in Lua to tell two same-named books apart. */
export const pageChecksum = namingModule.pageChecksum as (text: string) => number;
