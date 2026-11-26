/**
 * Talking to ElevenLabs about voices.
 *
 * listVoices resolves the roster by name, and the name filter is the whole contract: a
 * voice this app creates is only usable if it passes.
 *
 * `fetch` and the base URL are both injectable: no test should need an ElevenLabs account,
 * and none should ever spend money.
 */
import { slotClones } from "./slots";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export type Fetch = typeof globalThis.fetch;

export type ElevenLabsOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: Fetch;
  /** For tests: how long an account read may take (ACCOUNT_READ_TIMEOUT_MS otherwise). */
  timeoutMs?: number;
};

function config(options: ElevenLabsOptions = {}) {
  // No fallback to a server-wide key. Every request is spent from the signed-in user's
  // own account, so the caller has to say whose - see requireApiKey in
  // lib/generation/authz.ts. A route that reaches here with nothing has skipped that
  // guard, and throwing is how that shows up in a log rather than on somebody's bill.
  const { apiKey } = options;
  if (!apiKey) throw new Error("no ElevenLabs key was supplied for this request");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

/**
 * ElevenLabs reports failures as JSON with a `detail` field, and the text is the only clue
 * to what went wrong — a plan without cloning, a duplicate name, an unusable sample. Losing
 * it behind a generic message would make every failure a support ticket.
 */
export async function failure(response: Response, what: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${what} failed (${response.status}): ${body.slice(0, 300)}`);
}

/**
 * How long a read of the account (voices, models, subscription) may take.
 *
 * /voices and /lexicon cannot render without one, and fetch never gives up on its own: while
 * ElevenLabs was degraded, both pages hung until nginx answered 504. Ten seconds is far beyond
 * a healthy answer, and past it the pages show the account as unreadable instead.
 */
const ACCOUNT_READ_TIMEOUT_MS = 10_000;

/** GET an account endpoint and parse its JSON, failing after the timeout rather than waiting. */
async function readAccount(
  options: ElevenLabsOptions,
  path: string,
  what: string,
): Promise<unknown> {
  const { apiKey, baseUrl, fetchImpl } = config(options);
  const ms = options.timeoutMs ?? ACCOUNT_READ_TIMEOUT_MS;
  // One signal for the headers and the body alike: a stalled body hangs as surely as no answer.
  const signal = AbortSignal.timeout(ms);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw await failure(response, what);
    return await response.json();
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`${what} timed out: ElevenLabs did not answer within ${ms / 1000}s`);
    }
    throw error;
  }
}

/**
 * Voices in the account that this project can use, as clone name -> voice id: every
 * language's, `dwarf-male-grim` and `dwarf-male-grim@deDE` alike (see clone-name.ts).
 * generationStatus picks one language's out.
 */
export async function listVoices(options: ElevenLabsOptions = {}): Promise<Map<string, string>> {
  const body = (await readAccount(options, "/v1/voices", "listing ElevenLabs voices")) as {
    voices?: { name?: string; voice_id?: string }[];
  };

  const named = (body.voices ?? []).flatMap((voice) =>
    voice.name && voice.voice_id ? [{ name: voice.name, id: voice.voice_id }] : [],
  );
  // Stock voices are skipped rather than reported: their names ("Roger - Laid-Back,
  // Casual, Resonant") cannot express a race-gender mapping, so they are not candidates.
  const slotted = await slotClones(named.map((voice) => voice.name));
  return new Map(named.filter((voice) => slotted.has(voice.name)).map((voice) => [voice.name, voice.id]));
}

/** A voice in the account, whatever it is called: what the picker offers to fill a slot with. */
export type AccountVoice = {
  voiceId: string;
  name: string;
  /** ElevenLabs' own: "cloned", "generated", "professional", "premade" and so on. */
  category: string;
};

/**
 * Every voice in the account, slot-named or not, by name.
 *
 * listVoices is the roster; this is the account as the ElevenLabs dashboard shows it, so a
 * voice designed or added from the library there can be adopted into a slot (renameVoice).
 */
export async function listAccountVoices(options: ElevenLabsOptions = {}): Promise<AccountVoice[]> {
  const body = (await readAccount(options, "/v1/voices", "listing ElevenLabs voices")) as {
    voices?: { name?: string; voice_id?: string; category?: string }[];
  };
  return (body.voices ?? [])
    .flatMap((voice) =>
      voice.name && voice.voice_id
        ? [{ voiceId: voice.voice_id, name: voice.name, category: voice.category ?? "unknown" }]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Premade voices are ElevenLabs' own and cannot be edited, so they cannot take a slot's name.
 * Their ids are shared by every account, which is what binding one would need instead.
 */
export function isRenamable(voice: AccountVoice): boolean {
  return voice.category !== "premade";
}

/** Rename a voice in the account. Only the name changes: samples and settings stay. */
export async function renameVoice(
  voiceId: string,
  name: string,
  options: ElevenLabsOptions = {},
): Promise<void> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  // The edit endpoint takes multipart only, even with no files in it.
  const form = new FormData();
  form.append("name", name);
  const response = await fetchImpl(`${baseUrl}/v1/voices/${voiceId}/edit`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!response.ok) throw await failure(response, `renaming voice ${voiceId} to "${name}"`);
}

/**
 * What the plan allows and how much of it is left.
 *
 * The character budget is the reason this exists: Creator is 131,000 characters a month, and
 * one talkative NPC is a visible fraction of that. Regenerating a whole NPC without seeing
 * the balance first is how a month's budget disappears in one click.
 */
export type Subscription = {
  tier: string;
  characterCount: number;
  characterLimit: number;
  /** When the character count resets, ISO, or null if the account reports no reset. */
  resetAt: string | null;
  voiceSlotsUsed: number;
  voiceLimit: number;
};

export async function getSubscription(options: ElevenLabsOptions = {}): Promise<Subscription> {
  const body = (await readAccount(
    options,
    "/v1/user/subscription",
    "reading the ElevenLabs subscription",
  )) as Record<string, unknown>;
  const number = (key: string) => (typeof body[key] === "number" ? (body[key] as number) : 0);
  const reset = body.next_character_count_reset_unix;

  return {
    tier: typeof body.tier === "string" ? body.tier : "unknown",
    characterCount: number("character_count"),
    characterLimit: number("character_limit"),
    resetAt: typeof reset === "number" ? new Date(reset * 1000).toISOString() : null,
    voiceSlotsUsed: number("voice_slots_used"),
    voiceLimit: number("voice_limit"),
  };
}

/**
 * A model the account may generate with.
 *
 * Read from the account rather than listed in the code. Hardcoding the list meant the
 * settings page silently withheld a model ElevenLabs had already made available - the
 * options should be whatever the plan actually allows, not whatever was true when this was
 * written.
 */
export type Model = {
  id: string;
  name: string;
  description: string;
  /** Longest single request the model accepts, which bounds a line rather than a batch. */
  maxCharacters: number | null;
  languages: number;
};

export async function listModels(options: ElevenLabsOptions = {}): Promise<Model[]> {
  const body = (await readAccount(options, "/v1/models", "listing ElevenLabs models")) as unknown;
  if (!Array.isArray(body)) return [];

  return body
    .filter(
      (model): model is Record<string, unknown> =>
        Boolean(model) &&
        typeof model === "object" &&
        // Speech-to-speech and sound-effect models share this endpoint and cannot voice a
        // line, so offering them would be offering a guaranteed failure.
        (model as Record<string, unknown>).can_do_text_to_speech === true &&
        typeof (model as Record<string, unknown>).model_id === "string",
    )
    .map((model) => ({
      id: model.model_id as string,
      name: typeof model.name === "string" ? model.name : (model.model_id as string),
      description: typeof model.description === "string" ? model.description : "",
      maxCharacters:
        typeof model.maximum_text_length_per_request === "number"
          ? model.maximum_text_length_per_request
          : null,
      languages: Array.isArray(model.languages) ? model.languages.length : 0,
    }));
}

export type Clip = { name: string; data: Buffer };

/**
 * Create an instant voice clone.
 *
 * Background noise removal is always on: the clips can carry music beds and ambience, and
 * similarity_boost at synthesis time reproduces whatever is in the source.
 */
export async function addVoice(
  name: string,
  clips: Clip[],
  options: ElevenLabsOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const form = new FormData();
  form.append("name", name);
  form.append("remove_background_noise", "true");
  for (const clip of clips) {
    form.append("files", new Blob([new Uint8Array(clip.data)]), clip.name);
  }

  // No Content-Type header: fetch sets it, with the multipart boundary, which cannot be
  // written by hand.
  const response = await fetchImpl(`${baseUrl}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!response.ok) throw await failure(response, `creating the voice "${name}"`);

  const body = (await response.json()) as { voice_id?: string };
  if (!body.voice_id) throw new Error(`ElevenLabs created "${name}" but returned no voice_id`);
  return body.voice_id;
}

/** Where a set of rules ended up: the pair a TTS request has to name to use them. */
export type DictionaryLocator = { dictionaryId: string; versionId: string };

/**
 * Create a dictionary from a set of rules and get back the locator for them.
 *
 * This is how a dictionary is brought into existence, not how one is kept up to date. A save
 * updates the dictionary named by ELEVENLABS_DICTIONARY_ID in place - see updateDictionary -
 * so that the id stays the same forever and a sibling project can name it in its own config
 * and keep getting the current rules. This function runs only when no id is configured, and
 * the id it returns is the one to adopt.
 *
 * The rules are phoneme rules, honoured only by the models in PHONEME_SYNTAX. This function
 * does not check the model: the dictionary is worth uploading regardless, and the model can
 * change afterwards without re-uploading.
 */
export async function createPronunciationDictionary(
  name: string,
  rules: unknown[],
  options: ElevenLabsOptions = {},
): Promise<DictionaryLocator> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/pronunciation-dictionaries/add-from-rules`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name, rules }),
  });
  if (!response.ok) throw await failure(response, "uploading the pronunciation dictionary");

  const body = (await response.json()) as { id?: string; version_id?: string };
  if (!body.id || !body.version_id) {
    throw new Error("ElevenLabs accepted the dictionary but returned no id and version");
  }
  return { dictionaryId: body.id, versionId: body.version_id };
}

/** Not 401, which is a key missing the permission and would fail again on a dictionary of its own. */
const UNREADABLE_STATUSES = new Set([400, 403, 404, 422]);

/** The id is not one this key's account can use, as opposed to the read having failed. */
export class DictionaryUnreadable extends Error {}

/** What a stored dictionary holds right now: its newest version, and the rules in it. */
export type StoredDictionary = { latestVersionId: string; ruleStrings: string[] };

/**
 * Read a dictionary's current state by id.
 *
 * The `rules` array is what makes an in-place update knowable: it says which strings the
 * dictionary is matching today, and therefore which of them the lexicon no longer wants.
 * A response without it is treated as a failure rather than as "no rules", because the
 * difference between those two is a rule left in force that the editor page cannot show.
 */
export async function readDictionary(
  dictionaryId: string,
  options: ElevenLabsOptions = {},
): Promise<StoredDictionary> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/pronunciation-dictionaries/${dictionaryId}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await failure(response, `reading pronunciation dictionary ${dictionaryId}`);
    throw UNREADABLE_STATUSES.has(response.status) ? new DictionaryUnreadable(error.message) : error;
  }

  const body = (await response.json()) as {
    latest_version_id?: string;
    rules?: { string_to_replace?: string }[];
  };
  if (!body.latest_version_id) {
    throw new Error(`pronunciation dictionary ${dictionaryId} returned no version id`);
  }
  if (!Array.isArray(body.rules)) {
    throw new Error(
      `pronunciation dictionary ${dictionaryId} returned no rules, so the rules it no longer ` +
        "needs cannot be identified; refusing to update it half way",
    );
  }

  return {
    latestVersionId: body.latest_version_id,
    ruleStrings: body.rules.flatMap((rule) => (rule.string_to_replace ? [rule.string_to_replace] : [])),
  };
}

/**
 * Add rules to an existing dictionary, and return the version that results.
 *
 * An upsert, not an append: ElevenLabs replaces any rule already matching the same
 * `string_to_replace`. That is what lets a save be "send everything the lexicon holds"
 * rather than a diff, and it is why the id can stay stable without the update needing to
 * work out which rules changed.
 */
export async function addDictionaryRules(
  dictionaryId: string,
  rules: unknown[],
  options: ElevenLabsOptions = {},
): Promise<string> {
  return ruleChange(dictionaryId, "add-rules", { rules }, options);
}

/** Drop rules by the string they match, and return the version that results. */
export async function removeDictionaryRules(
  dictionaryId: string,
  ruleStrings: string[],
  options: ElevenLabsOptions = {},
): Promise<string> {
  return ruleChange(dictionaryId, "remove-rules", { rule_strings: ruleStrings }, options);
}

async function ruleChange(
  dictionaryId: string,
  endpoint: "add-rules" | "remove-rules",
  body: unknown,
  options: ElevenLabsOptions,
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(
    `${baseUrl}/v1/pronunciation-dictionaries/${dictionaryId}/${endpoint}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await failure(response, `${endpoint} on dictionary ${dictionaryId}`);

  const parsed = (await response.json()) as { version_id?: string };
  if (!parsed.version_id) throw new Error(`${endpoint} returned no version id`);
  return parsed.version_id;
}

/**
 * Read a dictionary back, as the PLS ElevenLabs stores it.
 *
 * The only way to find out what it actually kept. add-from-rules answers 200 with an id and a
 * version whether it accepted every rule or silently dropped most of them, so counting the
 * lexemes here is the difference between an upload that worked and one that appeared to.
 */
export async function downloadPronunciationDictionary(
  locator: DictionaryLocator,
  options: ElevenLabsOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(
    `${baseUrl}/v1/pronunciation-dictionaries/${locator.dictionaryId}/${locator.versionId}/download`,
    { headers: { "xi-api-key": apiKey }, cache: "no-store" },
  );
  if (!response.ok) throw await failure(response, "reading the pronunciation dictionary back");
  return response.text();
}

/** How many rules a stored dictionary holds. One lexeme per rule. */
export function countLexemes(pls: string): number {
  return (pls.match(/<lexeme\b/g) ?? []).length;
}

export async function deleteVoice(
  voiceId: string,
  options: ElevenLabsOptions = {},
): Promise<void> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) throw await failure(response, `deleting voice ${voiceId}`);
}

export type DesignedPreview = { generatedVoiceId: string; audio: Buffer };

/**
 * Voice Design: previews of a voice made from a description alone. Nothing is created in the
 * account until one is saved (createDesignedVoice), and no audio is ever sent.
 */
export async function designPreviews(
  input: { prompt: string; text: string },
  options: ElevenLabsOptions = {},
): Promise<DesignedPreview[]> {
  const { apiKey, baseUrl, fetchImpl } = config(options);
  const response = await fetchImpl(`${baseUrl}/v1/text-to-voice/design`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_description: input.prompt, text: input.text, model_id: "eleven_ttv_v3" }),
  });
  if (!response.ok) throw await failure(response, "designing a voice");
  const body = (await response.json()) as { previews?: { generated_voice_id?: string; audio_base_64?: string }[] };
  const previews = (body.previews ?? []).flatMap((preview) =>
    preview.generated_voice_id && preview.audio_base_64
      ? [{ generatedVoiceId: preview.generated_voice_id, audio: Buffer.from(preview.audio_base_64, "base64") }]
      : [],
  );
  if (previews.length === 0) throw new Error("ElevenLabs designed no previews");
  return previews;
}

/** Voice Remix's settings, as ElevenLabs names them; unset ones take its defaults. */
export type RemixOptions = {
  /** 0 keeps the voice, 1 follows the changes; only eleven_ttv_v3 voices take it. */
  promptStrength?: number | null;
  /** Lower is freer; high values can sound artificial. ElevenLabs' default is 2. */
  guidanceScale?: number | null;
  /** -1 quietest to 1 loudest. ElevenLabs' default is 0.5. */
  loudness?: number | null;
  seed?: number | null;
};

/** Variants of one of the account's own voices, changed as the description says. */
export async function remixPreviews(
  input: { voiceId: string; changes: string; text: string } & RemixOptions,
  options: ElevenLabsOptions = {},
): Promise<DesignedPreview[]> {
  const { apiKey, baseUrl, fetchImpl } = config(options);
  const body: Record<string, unknown> = { voice_description: input.changes, text: input.text };
  if (input.promptStrength != null) body.prompt_strength = input.promptStrength;
  if (input.guidanceScale != null) body.guidance_scale = input.guidanceScale;
  if (input.loudness != null) body.loudness = input.loudness;
  if (input.seed != null) body.seed = input.seed;
  const response = await fetchImpl(`${baseUrl}/v1/text-to-voice/${encodeURIComponent(input.voiceId)}/remix`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response, "remixing a voice");
  const answer = (await response.json()) as { previews?: { generated_voice_id?: string; audio_base_64?: string }[] };
  const previews = (answer.previews ?? []).flatMap((preview) =>
    preview.generated_voice_id && preview.audio_base_64
      ? [{ generatedVoiceId: preview.generated_voice_id, audio: Buffer.from(preview.audio_base_64, "base64") }]
      : [],
  );
  if (previews.length === 0) throw new Error("ElevenLabs remixed no previews");
  return previews;
}

export async function createDesignedVoice(
  input: { name: string; prompt: string; generatedVoiceId: string },
  options: ElevenLabsOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);
  const response = await fetchImpl(`${baseUrl}/v1/text-to-voice`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      voice_name: input.name,
      voice_description: input.prompt,
      generated_voice_id: input.generatedVoiceId,
    }),
  });
  if (!response.ok) throw await failure(response, `saving the voice "${input.name}"`);
  const body = (await response.json()) as { voice_id?: string };
  if (!body.voice_id) throw new Error(`ElevenLabs saved "${input.name}" but returned no voice_id`);
  return body.voice_id;
}
