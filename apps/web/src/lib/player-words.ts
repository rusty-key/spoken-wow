/**
 * The site's typed face of pipelines/lib/player-words.mjs, which pack builds run without a
 * TypeScript loader. CLIENT-SAFE: the explorer asks the text gate, and the gate asks this.
 */
import * as words from "../../../../pipelines/lib/player-words.mjs";
import type { Lang, PlayerWords } from "./lang";

export const branchesOnPlayerGender = words.branchesOnPlayerGender as (text: string) => boolean;

export const playerGenderSides = words.playerGenderSides as (text: string) => [string, string];

type ReaderTokens = Record<"N" | "C" | "R", number>;
export const playerTokenCounts = words.playerTokenCounts as (
  text: string,
  lang: Lang,
) => { G: number; m: ReaderTokens; f: ReaderTokens };

export const speakPlayerTokens = words.speakPlayerTokens as (
  text: string,
  lang: Lang,
  playerGender?: "m" | "f" | null,
) => string;

/** Words as stored, trimmed, or null where any is missing or unspeakable. */
export const validPlayerWords = words.validPlayerWords as (value: unknown) => PlayerWords | null;

export const PLAYER_WORD_LIMIT = words.WORD_LIMIT as number;

/** Whether Spoken has default words for `lang`, which a row's words replace. */
export const hasBuiltinPlayerWords = words.hasBuiltinPlayerWords as (lang: string) => boolean;

export const hasRegisteredPlayerWords = words.hasRegisteredPlayerWords as (lang: string) => boolean;

export const builtinPlayerWordsOf = words.builtinPlayerWordsOf as (lang: string) => PlayerWords | null;

export const playerWordsOf = words.playerWordsOf as (lang: string) => PlayerWords | null;
