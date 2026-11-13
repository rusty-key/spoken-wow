/**
 * The site's typed face of pipelines/lib/player-words.mjs, which pack builds run without a
 * TypeScript loader. CLIENT-SAFE: the explorer asks the text gate, and the gate asks this.
 */
import * as words from "../../../../pipelines/lib/player-words.mjs";
import type { Lang } from "./lang";

export const branchesOnPlayerGender = words.branchesOnPlayerGender as (text: string) => boolean;

export const playerGenderSides = words.playerGenderSides as (text: string) => [string, string];

export const speakPlayerTokens = words.speakPlayerTokens as (
  text: string,
  lang: Lang,
  playerGender?: "m" | "f" | null,
) => string;
