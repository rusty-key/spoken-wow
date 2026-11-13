/**
 * Which generator a collaborator spends with, and how they have set each one up.
 *
 * The collaborator's, not an admin's (migrations 0041 and 0044): each generates with their
 * own key, so each decides which provider that key is for and how it is used. One set of
 * settings per provider, for every language; the choice between them is per language (0046).
 * What stays an admin's, per language, is the race accent tags, because they change the text
 * that is sent and staleness hashes that text.
 *
 * No row is fish.audio on its free model, with the built-in settings for both providers.
 */
import "server-only";

import { db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { DEFAULT_FISH_MODEL, isFishModel, RENAMED_FISH_MODELS } from "@/lib/voices/fish";

import type { GenerationConfig } from "./config";
import { fileDefaults } from "./files";
import { FISH_DEFAULTS, type FishSettings } from "./fish-tts";
import { currentConfig, SettingsError, validateConfig } from "./settings";
import type { Provider } from "./speakers/speaker";

/** ElevenLabs' model, voice settings and seed strategy: everything but the accent tags. */
export type ElevenLabsSettings = Omit<GenerationConfig, "raceTags">;

export type Preference = { provider: Provider; elevenlabs: ElevenLabsSettings; fish: FishSettings };

/**
 * voice/generation.json's settings, which were in force for anybody with no settings row, so
 * a collaborator who has chosen nothing hears what they would have heard before.
 */
export function defaultElevenLabs(): ElevenLabsSettings {
  const { raceTags: _, ...settings } = fileDefaults().config;
  return settings;
}

export function defaultPreference(): Preference {
  return {
    provider: "fish",
    elevenlabs: defaultElevenLabs(),
    fish: { model: DEFAULT_FISH_MODEL, ...FISH_DEFAULTS },
  };
}

export class PreferenceError extends Error {}

/** fish.audio's documented ranges (docs.fish.audio, the TTS request schema). */
const RANGES = {
  temperature: [0, 1],
  topP: [0, 1],
  speed: [0.5, 2],
} as const;

/**
 * Coerce and check untrusted fish settings, or throw PreferenceError.
 *
 * The model is checked against the list rather than passed through, because fish.audio
 * quietly falls back to s2.1-pro for a model it does not know -- a typo would be billed at
 * full price with nothing saying so.
 */
export function validateFish(input: unknown): FishSettings {
  if (!input || typeof input !== "object") throw new PreferenceError("fish settings must be an object");
  const raw = { ...(input as Record<string, unknown>) };
  if (typeof raw.model === "string") raw.model = RENAMED_FISH_MODELS[raw.model] ?? raw.model;
  if (!isFishModel(raw.model)) throw new PreferenceError(`unknown fish.audio model ${String(raw.model)}`);

  const number = (key: keyof typeof RANGES) => {
    const value = Number(raw[key]);
    const [min, max] = RANGES[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new PreferenceError(`${key} must be between ${min} and ${max}`);
    }
    return value;
  };
  return {
    model: raw.model,
    temperature: number("temperature"),
    topP: number("topP"),
    speed: number("speed"),
  };
}

/**
 * Coerce and check untrusted ElevenLabs settings, or throw PreferenceError.
 *
 * The admin form's own validation, less the accent tags, so the two can never disagree about
 * what a valid setting is. The model is not checked against a list: which models exist is the
 * account's answer, and /voices offers only those.
 */
export function validateElevenLabs(input: unknown): ElevenLabsSettings {
  try {
    const { raceTags: _, ...settings } = validateConfig({
      ...(input && typeof input === "object" ? input : {}),
      raceTags: {},
    });
    return settings;
  } catch (error) {
    if (error instanceof SettingsError) throw new PreferenceError(error.message);
    throw error;
  }
}

/** A collaborator's settings for both providers, which are one set for every language. */
export async function readGenerationSettings(
  userId: string,
): Promise<Pick<Preference, "elevenlabs" | "fish">> {
  const { elevenlabs, fish } = await readPreference(userId, null);
  return { elevenlabs, fish };
}

/**
 * The generator a collaborator spends with in `lang`, and their settings.
 *
 * The choice is per language (0046) and falls back to the one made before it was: a
 * collaborator who has never activated a provider on a language's /voices keeps whatever
 * they had chosen on /profile. `lang` null reads that fallback alone, for callers that only
 * want the settings.
 */
export async function readPreference(userId: string, lang: Lang | null): Promise<Preference> {
  const defaults = defaultPreference();
  const { rows } = await db().query<{
    provider: Provider | null;
    localeProvider: Provider | null;
    elevenlabs: unknown;
    fish: unknown;
  }>(
    `select p."provider", l."provider" as "localeProvider", p."elevenlabs", p."fish"
       from (select $1::text as "userId") u
       left join "generation_preference" p on p."userId" = u."userId"
       left join "generation_preference_locale" l on l."userId" = u."userId" and l."lang" = $2`,
    [userId, lang],
  );
  const row = rows[0];
  if (!row) return defaults;

  // Stored settings that no longer validate -- a model fish.audio has since withdrawn -- read
  // as the defaults rather than failing every line: the collaborator sees them on /voices
  // and can choose again.
  const valid = <T>(raw: unknown, check: (input: unknown) => T, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return check(raw);
    } catch {
      return fallback;
    }
  };
  return {
    provider: row.localeProvider ?? row.provider ?? defaults.provider,
    elevenlabs: valid(row.elevenlabs, validateElevenLabs, defaults.elevenlabs),
    fish: valid(row.fish, validateFish, defaults.fish),
  };
}

/**
 * Save a collaborator's settings for both providers.
 *
 * Leaves generation_preference."provider" alone on an existing row: that column is now only
 * the fallback for languages with no choice of their own, and saving a setting on one
 * language's page must not move every other language onto a different generator.
 */
export async function writeGenerationSettings(
  userId: string,
  settings: Pick<Preference, "elevenlabs" | "fish">,
): Promise<void> {
  await db().query(
    `insert into "generation_preference" ("userId", "elevenlabs", "fish", "updatedAt")
     values ($1, $2::jsonb, $3::jsonb, now())
     on conflict ("userId") do update set
       "elevenlabs" = excluded."elevenlabs",
       "fish" = excluded."fish",
       "updatedAt" = now()`,
    [userId, JSON.stringify(settings.elevenlabs), JSON.stringify(settings.fish)],
  );
}

/** Make `provider` the generator a collaborator spends with in `lang`. */
export async function writeProvider(userId: string, lang: Lang, provider: Provider): Promise<void> {
  await db().query(
    `insert into "generation_preference_locale" ("userId", "lang", "provider", "updatedAt")
     values ($1, $2, $3, now())
     on conflict ("userId", "lang") do update set
       "provider" = excluded."provider",
       "updatedAt" = now()`,
    [userId, lang, provider],
  );
}

/**
 * What ElevenLabs is sent with for this collaborator in `lang`: their own settings, and the
 * language's accent tags, which are the one part of the settings that stayed per language.
 */
export async function speakingConfig(
  elevenlabs: ElevenLabsSettings,
  lang: Lang,
): Promise<GenerationConfig> {
  return { ...elevenlabs, raceTags: (await currentConfig(lang)).raceTags };
}
