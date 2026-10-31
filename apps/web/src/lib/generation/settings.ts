/**
 * The global generation settings: reading them, and changing them safely.
 *
 * Two layers. voice/generation.json ships in the release and is what the Python CLI reads;
 * the generation_setting row, when present, is what the web app generates with. Reading
 * reports which of the two is in force, because "why does this sound different from what
 * the CLI made" is otherwise unanswerable.
 *
 * Validation mirrors save_generation in tts_cli/voice_config.py. It lives on the write path
 * rather than the read path on purpose: a value already in the database is a fact, and
 * refusing to read it would take the settings page down exactly when it is needed to fix it.
 *
 * Every team has a generation_setting row of its own, its base: English's is the english
 * team's, and every other team's began as a copy of it (migration 0089). A language's own
 * generation_setting_locale row, when it has one, is its team's too. A language nobody has
 * configured reads its team's base, so it never needs another team's row.
 */
import { recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, queryIn, TEAM_ROWS, TEAMS_IN_SCOPE } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { bareDirection } from "@/lib/generation/narration";
import { queryAs, readAs, teamOrEnglish } from "@/lib/teams/store";

import {
  isSeedStrategy,
  UNIT_INTERVAL,
  type GenerationConfig,
  type VoiceSettings,
} from "./config";
import { fileDefaults } from "./files";

export type EffectiveSettings = {
  config: GenerationConfig;
  /**
   * Where the settings in force come from: the committed file, a saved row, or -- for a
   * language nobody has configured yet -- English's, without its accent tags.
   */
  source: "file" | "database" | "english";
  /** The committed values, so the page can offer "reset to defaults" and show the delta. */
  defaults: GenerationConfig;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Row = {
  modelId: string;
  voiceSettings: VoiceSettings;
  seedStrategy: string;
  raceTags: Record<string, string> | null;
  updatedAt: string;
  updatedBy: string | null;
};

export async function readSettings(lang: Lang = BASE_LANG): Promise<EffectiveSettings> {
  if (lang !== BASE_LANG) return readLanguageSettings(lang);
  return baseSettings(await readBase(BASE_LANG));
}

/** The base row of the team that owns `lang`, or English's for a language nobody owns. */
async function readBase(lang: Lang): Promise<Row | undefined> {
  const rows = await queryIn<Row>(
    await teamOrEnglish(lang),
    `select "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy"
       from "generation_setting" where ${TEAM_ROWS}`,
  );
  return rows[0];
}

function baseSettings(row: Row | undefined): EffectiveSettings {
  const defaults = fileDefaults().config;
  if (!row) {
    return { config: defaults, source: "file", defaults, updatedAt: null, updatedBy: null };
  }

  return {
    config: {
      modelId: row.modelId,
      voiceSettings: row.voiceSettings,
      // Defended rather than trusted: the column is text, and a strategy the code does not
      // implement must fall back to a working one instead of throwing mid-generation.
      seedStrategy: isSeedStrategy(row.seedStrategy) ? row.seedStrategy : defaults.seedStrategy,
      // Empty, not the committed tags, when the column is null: a row written by the release
      // before this column existed said nothing about accents, and inheriting the file's
      // tags would start tagging lines that nobody asked to have tagged.
      raceTags: row.raceTags ?? {},
    },
    source: "database",
    defaults,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * Another language's settings: its own row, or its team's base -- English's, as copied --
 * until somebody saves one.
 *
 * The base without the accent tags, though. A tag like "[Scottish accent]" is a direction
 * about how English is spoken, and a language that has not chosen its own should not start
 * with someone else's.
 */
async function readLanguageSettings(lang: Lang): Promise<EffectiveSettings> {
  const [english, rows] = await Promise.all([
    readBase(lang).then(baseSettings),
    readAs<Row>(
      lang,
      `select "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy"
         from "generation_setting_locale" where "lang" = $1`,
      [lang],
    ),
  ]);
  const row = rows[0];
  if (!row) {
    return {
      config: { ...english.config, raceTags: {} },
      source: "english",
      defaults: english.defaults,
      updatedAt: null,
      updatedBy: null,
    };
  }
  return {
    config: {
      modelId: row.modelId,
      voiceSettings: row.voiceSettings,
      seedStrategy: isSeedStrategy(row.seedStrategy) ? row.seedStrategy : english.config.seedStrategy,
      raceTags: row.raceTags ?? {},
    },
    source: "database",
    defaults: english.defaults,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The settings actually used to generate. Convenience over readSettings for the hot path. */
export async function currentConfig(lang: Lang = BASE_LANG): Promise<GenerationConfig> {
  return (await readSettings(lang)).config;
}

export class SettingsError extends Error {}

/**
 * Coerce and check an untrusted body into a config, or throw SettingsError.
 *
 * Whole-object rather than patch semantics: the settings page always sends every field, and
 * a partial update against a row read a moment earlier is how two admins silently overwrite
 * each other.
 */
export function validateConfig(input: unknown): GenerationConfig {
  if (!input || typeof input !== "object") throw new SettingsError("expected a settings object");
  const raw = input as Record<string, unknown>;

  const modelId = raw.modelId;
  if (typeof modelId !== "string" || !modelId.trim()) {
    throw new SettingsError("modelId must be a non-empty string");
  }

  const settings = raw.voiceSettings;
  if (!settings || typeof settings !== "object") {
    throw new SettingsError("voiceSettings must be an object");
  }
  const values = settings as Record<string, unknown>;

  const voiceSettings = { use_speaker_boost: true } as VoiceSettings;
  for (const key of UNIT_INTERVAL) {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new SettingsError(`${key} must be a number`);
    }
    if (value < 0 || value > 1) {
      throw new SettingsError(`${key} must be between 0 and 1, got ${value}`);
    }
    voiceSettings[key] = value;
  }
  if (typeof values.use_speaker_boost !== "boolean") {
    throw new SettingsError("use_speaker_boost must be a boolean");
  }
  voiceSettings.use_speaker_boost = values.use_speaker_boost;

  if (!isSeedStrategy(raw.seedStrategy)) {
    throw new SettingsError(`unknown seed strategy ${JSON.stringify(raw.seedStrategy)}`);
  }

  return {
    modelId: modelId.trim(),
    voiceSettings,
    seedStrategy: raw.seedStrategy,
    raceTags: validateRaceTags(raw.raceTags),
  };
}

/**
 * The accent directions, checked for the ways a tag can quietly do the wrong thing.
 *
 * Shape only: the keys - a race, or one voice slot of it - are not checked against the
 * corpus. Validating them would mean loading the corpus on every settings write, and the form
 * offers only the races and slots on the roster, so a name no line carries is not reachable
 * through the UI - it would simply match nothing, which is the same as not setting it.
 */
export function validateRaceTags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsError("raceTags must be an object");
  }

  const tags: Record<string, string> = {};
  for (const [race, tag] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tag !== "string") throw new SettingsError(`the ${race} tag must be a string`);
    const trimmed = tag.trim();
    if (!bareDirection(trimmed)) {
      throw new SettingsError(`the ${race} tag is empty; remove it instead`);
    }
    // narration.ts splits speech from stage directions on angle brackets, so a tag carrying
    // one would be read by the narrator rather than tagging the race it belongs to.
    if (/[<>]/.test(trimmed)) {
      throw new SettingsError(`the ${race} tag must not contain an angle bracket`);
    }
    tags[race] = storedDirection(trimmed, race);
  }
  return tags;
}

/**
 * A direction as typed, in the square brackets eleven_v3 performs rather than reads.
 *
 * The brackets are added here rather than at generation, so the stored form - and so every
 * spoken text and take hash made from it - is what it was when people typed them by hand.
 * Rewriting the rows bare instead would need a migration the release before this one cannot
 * read: it would send "Scottish accent" to be spoken aloud.
 *
 * A value already bracketed is kept as it is: the form sends the whole map on every save,
 * other entries included, and one typed before this change may be "[fast] [nasal]".
 */
function storedDirection(tag: string, key: string): string {
  if (tag.startsWith("[") && tag.endsWith("]")) return tag;
  if (/[[\]]/.test(tag)) {
    throw new SettingsError(`the ${key} tag must not contain a square bracket; they are added for you`);
  }
  return `[${tag}]`;
}

/**
 * Another language's settings row, created whole from `config` and otherwise updating only
 * `columns` -- the model form and the accent tags are saved from different pages, and each
 * must not revert what the other just wrote.
 */
async function upsertLanguage(
  lang: Lang,
  config: GenerationConfig,
  updatedBy: string | null,
  columns: ("modelId" | "voiceSettings" | "seedStrategy" | "raceTags")[],
): Promise<void> {
  const set = columns.map((column) => `"${column}" = excluded."${column}"`).join(", ");
  await queryAs(
    lang,
    `insert into "generation_setting_locale"
       ("lang", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
     values ($1, $2, $3, $4, $5, now(), $6)
     on conflict ("teamId", "lang") do update set
       ${set}, "updatedAt" = excluded."updatedAt", "updatedBy" = excluded."updatedBy"`,
    [
      lang,
      config.modelId,
      JSON.stringify(config.voiceSettings),
      config.seedStrategy,
      JSON.stringify(config.raceTags),
      updatedBy,
    ],
  );
}

/**
 * Change the accent directions and nothing else.
 *
 * Its own write, rather than a field of the settings form, because the two are edited in
 * different places for different reasons: a tag belongs to one race and is set while looking
 * at that race's voices, whereas stability applies to everything and is set once. Sending the
 * whole config to change a tag would make a tag edit capable of reverting a model change made
 * a minute earlier in another tab.
 *
 * Whole-map rather than per-race, though. Removing a tag is as much an edit as adding one,
 * and a merge could not express it.
 *
 * The row has to exist to hold a tag, so this creates it from the committed defaults when it
 * does not - which overrides the model and the voice settings too, at whatever the file says
 * right now. readSettings reports the source, so the page can say so rather than leaving
 * someone to discover it.
 */
export async function writeRaceTags(
  tags: Record<string, string>,
  updatedBy: string | null,
  lang: Lang = BASE_LANG,
): Promise<void> {
  if (lang !== BASE_LANG) {
    // As for English: the row has to exist to hold a tag, and is created from the settings
    // in force -- English's, for a language nobody has configured.
    const current = (await readSettings(lang)).config;
    await upsertLanguage(lang, { ...current, raceTags: tags }, updatedBy, ["raceTags"]);
    await recordRaceTags(lang, updatedBy);
    return;
  }
  // Every team's base, as one: each team's began as a copy of English's (migration 0089), and
  // until a team edits its own, an edit of English's is an edit of theirs.
  const defaults = fileDefaults().config;
  await queryIn(
    ALL_TEAMS,
    `insert into "generation_setting"
       ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
     select "id", $1, $2, $3, $4, now(), $5 from (${TEAMS_IN_SCOPE}) t
     on conflict ("teamId") do update set
       "raceTags"  = excluded."raceTags",
       "updatedAt" = excluded."updatedAt",
       "updatedBy" = excluded."updatedBy"`,
    [
      defaults.modelId,
      JSON.stringify(defaults.voiceSettings),
      defaults.seedStrategy,
      JSON.stringify(tags),
      updatedBy,
    ],
  );
  await recordRaceTags(lang, updatedBy);
}

/**
 * Logged against the language even when the row written is English's generation_setting:
 * the other languages read that row only for its model and sliders, never its tags (see
 * readLanguageSettings), so a tag edit there changes English alone.
 */
async function recordRaceTags(lang: Lang, by: string | null): Promise<void> {
  await recordActivity({
    kind: "setting.changed",
    lang,
    actorId: by,
    detail: { setting: "raceTags" },
  });
}
