/**
 * A collaborator's generator choice, against the real table it lives in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/lib/db");
const {
  defaultPreference,
  readGenerationSettings,
  readPreference,
  validateElevenLabs,
  validateFish,
  writeGenerationSettings,
  writeProvider,
} = await import("./preference");
const DEFAULT_PREFERENCE = defaultPreference();

const USER = "test-generator-preference";
const FISH = { model: "s2.1-pro-free", temperature: 0.4, topP: 0.8, speed: 1.2 };
const ELEVEN = {
  modelId: "eleven_multilingual_v2",
  voiceSettings: { stability: 0.3, similarity_boost: 0.9, style: 0.1, use_speaker_boost: false },
  seedStrategy: "none" as const,
};

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Preference', $2, false) on conflict ("id") do nothing`,
    [USER, `${USER}@example.invalid`],
  );
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

describe("fish.audio settings", () => {
  it("take a known model and values in fish.audio's ranges", () => {
    expect(validateFish(FISH)).toEqual(FISH);
  });

  it("read a renamed model as what replaced it", () => {
    expect(validateFish({ ...FISH, model: "drama-3-preview" })).toEqual({ ...FISH, model: "drama-3" });
  });

  it.each([
    [{ ...FISH, model: "s1" }, /unknown fish.audio model/],
    [{ ...FISH, model: "s2.1-pr0" }, /unknown fish.audio model/],
    [{ ...FISH, temperature: 1.5 }, /temperature/],
    [{ ...FISH, topP: -0.1 }, /topP/],
    [{ ...FISH, speed: 3 }, /speed/],
    [{ ...FISH, speed: "fast" }, /speed/],
  ])("refuse %j", (input, message) => {
    expect(() => validateFish(input)).toThrow(message);
  });
});

describe("ElevenLabs settings", () => {
  it("take the admin form's shape, less the accent tags", () => {
    expect(validateElevenLabs(ELEVEN)).toEqual(ELEVEN);
    expect(validateElevenLabs({ ...ELEVEN, raceTags: { dwarf: "[x]" } })).not.toHaveProperty("raceTags");
  });

  it.each([
    [{ ...ELEVEN, modelId: "" }, /modelId/],
    [{ ...ELEVEN, voiceSettings: { ...ELEVEN.voiceSettings, stability: 2 } }, /stability/],
    [{ ...ELEVEN, seedStrategy: "random" }, /seed strategy/],
  ])("refuse %j", (input, message) => {
    expect(() => validateElevenLabs(input)).toThrow(message);
  });
});

describe("a preference", () => {
  it("is fish.audio's free model until one is saved", async () => {
    expect(await readPreference(USER, "enUS")).toEqual(DEFAULT_PREFERENCE);
    expect(DEFAULT_PREFERENCE.provider).toBe("fish");
    expect(DEFAULT_PREFERENCE.fish.model).toBe("s2.1-pro-free");
  });

  it("has the settings that were saved, in every language", async () => {
    await writeGenerationSettings(USER, { elevenlabs: ELEVEN, fish: FISH });
    expect(await readGenerationSettings(USER)).toEqual({ elevenlabs: ELEVEN, fish: FISH });
    expect(await readPreference(USER, "deDE")).toEqual({
      provider: "fish",
      elevenlabs: ELEVEN,
      fish: FISH,
    });
  });

  it("activates a provider in one language only", async () => {
    await writeProvider(USER, "deDE", "elevenlabs");
    expect((await readPreference(USER, "deDE")).provider).toBe("elevenlabs");
    expect((await readPreference(USER, "enUS")).provider).toBe("fish");
  });

  it("falls back to the choice made before it was per language", async () => {
    await db().query(`update "generation_preference" set "provider" = 'elevenlabs' where "userId" = $1`, [
      USER,
    ]);
    expect((await readPreference(USER, "frFR")).provider).toBe("elevenlabs");
    await writeProvider(USER, "frFR", "fish");
    expect((await readPreference(USER, "frFR")).provider).toBe("fish");
  });

  it("keeps the fallback when settings are saved again", async () => {
    await writeGenerationSettings(USER, { elevenlabs: ELEVEN, fish: FISH });
    expect((await readPreference(USER, "ptBR")).provider).toBe("elevenlabs");
  });

  it("falls back to the defaults for settings naming a withdrawn model", async () => {
    await db().query(
      `update "generation_preference" set "fish" = $2::jsonb where "userId" = $1`,
      [USER, JSON.stringify({ ...FISH, model: "s0-retired" })],
    );
    expect((await readPreference(USER, "enUS")).fish).toEqual(DEFAULT_PREFERENCE.fish);
  });
});
