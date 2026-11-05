/**
 * Reading voice/generation.json and voice/pronunciation.json off disk.
 *
 * Kept apart from config.ts so the settings form can import the shapes without dragging
 * node:fs into the browser bundle. Both ship inside the release, so they cannot change under
 * a running server without a deploy - which replaces the process - and are therefore read
 * once and memoised.
 *
 * There is deliberately no lexicon here. It lives in the pronunciation_lexicon row, seeded
 * once by migration 0008 and edited from the web UI after that. A file on disk could only be
 * a stale snapshot competing with the live data, which is why there is not one.
 */
import fs from "node:fs";
import path from "node:path";

import { VOICE_CONFIG_DIR } from "@/lib/paths";

import { BASE_LANG, type Lang } from "@/lib/lang";
import { speakPlayerTokens } from "@/lib/player-words";

import { FALLBACK, fromFileShape, type GenerationConfig } from "./config";
import { applyPronunciation } from "./pronunciation";

export function generationPath(dir: string = VOICE_CONFIG_DIR): string {
  return path.join(dir, "generation.json");
}

export function pronunciationPath(dir: string = VOICE_CONFIG_DIR): string {
  return path.join(dir, "pronunciation.json");
}

export function readGenerationFile(dir: string = VOICE_CONFIG_DIR): GenerationConfig {
  try {
    return fromFileShape(JSON.parse(fs.readFileSync(generationPath(dir), "utf8")));
  } catch (error) {
    console.warn(`could not read ${generationPath(dir)}, using built-in defaults:`, error);
    return FALLBACK;
  }
}

/**
 * Pronunciation rules: regex source -> replacement.
 *
 * Absent or unreadable means no rules. There is no built-in fallback because losing them
 * only costs pronunciation quality, whereas inlining a copy of data the Python side owns
 * would be a second place for it to drift.
 */
export function readPronunciationFile(dir: string = VOICE_CONFIG_DIR): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(pronunciationPath(dir), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([, value]) => typeof value === "string",
      ) as [string, string][],
    );
  } catch (error) {
    console.warn(`could not read ${pronunciationPath(dir)}, no rules applied:`, error);
    return {};
  }
}

export type FileDefaults = {
  config: GenerationConfig;
  rules: Record<string, string>;
};

const defaultsKey = Symbol.for("wow-voiceover.generation-defaults");
type Holder = { [defaultsKey]?: FileDefaults };

export function fileDefaults(): FileDefaults {
  const holder = globalThis as Holder;
  if (!holder[defaultsKey]) {
    holder[defaultsKey] = {
      config: readGenerationFile(),
      rules: readPronunciationFile(),
    };
  }
  return holder[defaultsKey]!;
}

/**
 * The committed pronunciation rules applied to a line, in the language it is spoken in.
 *
 * English only: the rules are English spellings of English words. Another language is
 * spoken with its own lexicon, through its dictionary, and nothing is rewritten before the
 * request. One function so that regenerating, and the staleness and dirt checks that must
 * reproduce exactly what regenerating sent, cannot disagree about it.
 */
export function committedPronunciation(text: string, lang: Lang): string {
  return lang === BASE_LANG ? applyPronunciation(text, fileDefaults().rules) : text;
}

/**
 * A quest line's text as it goes to the provider, before the provider's own shaping: a
 * translation's $N/$C/$R spoken as its language's words (player-words.ts), then the committed
 * rules. The same one function for the reason committedPronunciation is: regenerating hashes
 * this, and the staleness and dirt checks must arrive at the identical string.
 */
export function sentText(
  text: string,
  lang: Lang,
  playerGender: "m" | "f" | null,
): string {
  return committedPronunciation(speakPlayerTokens(text, lang, playerGender), lang);
}
