import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FALLBACK } from "./config";
import { SettingsError, validateConfig, validateRaceTags } from "./settings";

// The shape the settings form sends. Every field, every time: partial updates against a row
// read a moment earlier are how two admins silently overwrite each other.
const VALID = {
  modelId: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
  },
  seedStrategy: "npc",
  raceTags: { dwarf: "[Scottish accent]" },
};

describe("validateConfig", () => {
  it("accepts the committed defaults, whatever they currently are", () => {
    expect(validateConfig(FALLBACK)).toEqual(FALLBACK);
  });

  it("accepts a full, valid body", () => {
    expect(validateConfig(VALID)).toEqual(VALID);
  });

  describe("race tags", () => {
    it("accepts a race with no tag configured", () => {
      expect(validateConfig({ ...VALID, raceTags: {} }).raceTags).toEqual({});
    });

    it("refuses a body with no raceTags at all, so a stale form cannot clear them", () => {
      const { raceTags: _omitted, ...body } = VALID;
      expect(() => validateConfig(body)).toThrow(SettingsError);
    });

    it("refuses a tag that is not a string", () => {
      expect(() => validateConfig({ ...VALID, raceTags: { dwarf: 3 } })).toThrow(SettingsError);
    });

    it("refuses an empty tag", () => {
      expect(() => validateConfig({ ...VALID, raceTags: { dwarf: "   " } })).toThrow(
        SettingsError,
      );
    });

    // An angle bracket is how narration.ts tells a stage direction from speech, so a tag
    // containing one would be handed to the narrator instead of tagging the dwarf.
    it("refuses a tag containing an angle bracket", () => {
      expect(() => validateConfig({ ...VALID, raceTags: { dwarf: "<Scottish>" } })).toThrow(
        /angle bracket/,
      );
    });

    it("refuses a tag that is only brackets", () => {
      expect(() => validateConfig({ ...VALID, raceTags: { dwarf: "[ ]" } })).toThrow(/empty/);
    });

    // Stored bracketed, as people used to type them: a tag typed bare must be stored exactly as
    // the bracketed one was, or every take made with it would read as stale.
    it("brackets a tag typed bare, storing what the bracketed form stored", () => {
      expect(validateRaceTags({ dwarf: " Scottish accent " })).toEqual(
        validateRaceTags({ dwarf: "[Scottish accent]" }),
      );
      expect(validateRaceTags({ dwarf: "Scottish accent" })).toEqual({ dwarf: "[Scottish accent]" });
    });

    it("keeps a tag already in brackets as it is, so a whole-map save leaves the others alone", () => {
      expect(validateRaceTags({ goblin: "[fast] [nasal]" })).toEqual({ goblin: "[fast] [nasal]" });
    });

    it("refuses a bare tag with a stray square bracket", () => {
      expect(() => validateRaceTags({ dwarf: "Scottish] accent" })).toThrow(/square bracket/);
    });

    it("trims a tag", () => {
      expect(validateConfig({ ...VALID, raceTags: { dwarf: " [Scottish accent] " } })).toEqual({
        ...VALID,
        raceTags: { dwarf: "[Scottish accent]" },
      });
    });
  });

  it("trims the model id", () => {
    expect(validateConfig({ ...VALID, modelId: "  eleven_flash_v2_5 " }).modelId).toBe(
      "eleven_flash_v2_5",
    );
  });

  // Same bounds as save_generation in tts_cli/voice_config.py. ElevenLabs rejects these
  // itself, but a 422 arriving mid-batch is a far worse place to learn about it.
  describe("the unit-interval fields", () => {
    for (const key of ["stability", "similarity_boost", "style"] as const) {
      it(`refuses ${key} above 1`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: 1.5 } };
        expect(() => validateConfig(body)).toThrow(SettingsError);
        expect(() => validateConfig(body)).toThrow(/between 0 and 1/);
      });

      it(`refuses ${key} below 0`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: -0.01 } };
        expect(() => validateConfig(body)).toThrow(SettingsError);
      });

      it(`accepts ${key} at both ends of the range`, () => {
        for (const value of [0, 1]) {
          const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: value } };
          expect(validateConfig(body).voiceSettings[key]).toBe(value);
        }
      });

      it(`refuses ${key} as a string, rather than coercing it`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: "0.5" } };
        expect(() => validateConfig(body)).toThrow(/must be a number/);
      });

      it(`refuses ${key} as NaN`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: NaN } };
        expect(() => validateConfig(body)).toThrow(/must be a number/);
      });
    }
  });

  it("refuses a seed strategy nothing implements", () => {
    expect(() => validateConfig({ ...VALID, seedStrategy: "per-line" })).toThrow(
      /unknown seed strategy/,
    );
  });

  it("refuses an empty or missing model id", () => {
    expect(() => validateConfig({ ...VALID, modelId: "   " })).toThrow(/non-empty/);
    expect(() => validateConfig({ ...VALID, modelId: undefined })).toThrow(/non-empty/);
  });

  it("refuses a non-boolean speaker boost rather than reading it as truthy", () => {
    const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, use_speaker_boost: "yes" } };
    expect(() => validateConfig(body)).toThrow(/must be a boolean/);
  });

  it("refuses bodies that are not objects at all", () => {
    for (const body of [null, undefined, "settings", 42, []]) {
      expect(() => validateConfig(body)).toThrow(SettingsError);
    }
  });

  it("refuses a body with no voiceSettings", () => {
    expect(() => validateConfig({ modelId: "m", seedStrategy: "npc" })).toThrow(/voiceSettings/);
  });

  // Anything the form does not send is dropped rather than carried into the database, where
  // it would be sent to ElevenLabs on every line thereafter.
  it("keeps only the fields it knows", () => {
    const result = validateConfig({
      ...VALID,
      speed: 1.4,
      voiceSettings: { ...VALID.voiceSettings, speed: 1.4 },
    });
    expect(result).toEqual(VALID);
  });
});

/**
 * The write path, against a real Postgres: what is being tested is that a tag edit leaves the
 * rest of the row alone, and a mocked pg would only confirm the SQL was the SQL.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
const { closeDb, db } = await import("@/lib/db");
const { readSettings, writeRaceTags } = await import("./settings");

/**
 * The settings row, put back after every case.
 *
 * The english team's row, and it is whatever this database generates English with. A test
 * that deleted it would silently reset the settings of whatever DATABASE_URL points at - the
 * mistake dictionary.test.ts records having made with the lexicon.
 */
let snapshot: Record<string, unknown> | undefined;

beforeAll(async () => {
  const { rows } = await db().query(
    `select * from "generation_setting" where "teamId" = (select "id" from "team" where "slug" = 'english')`,
  );
  snapshot = rows[0];
});

/**
 * The precondition two cases below need: no override row at all.
 *
 * Deleting is safe here only because afterEach puts the snapshot back -- the row is the
 * settings of whatever DATABASE_URL points at, and this file is careful with it.
 */
async function noRow() {
  await db().query(`delete from "generation_setting" where "teamId" = (select "id" from "team" where "slug" = 'english')`);
}

afterEach(async () => {
  await db().query(`delete from "generation_setting_locale" where "lang" = 'koKR'`);
  await db().query(`delete from "generation_setting" where "teamId" = (select "id" from "team" where "slug" = 'english')`);
  if (snapshot) {
    await db().query(
      `insert into "generation_setting"
         ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
       values ((select "id" from "team" where "slug" = 'english'), $1, $2, $3, $4, $5, $6)`,
      [
        snapshot.modelId,
        JSON.stringify(snapshot.voiceSettings),
        snapshot.seedStrategy,
        snapshot.raceTags === null ? null : JSON.stringify(snapshot.raceTags),
        snapshot.updatedAt,
        snapshot.updatedBy,
      ],
    );
  }
});

afterAll(async () => {
  await closeDb();
});

describe("writeRaceTags", () => {
  it("stores the tags on a database with no override yet", async () => {
    await writeRaceTags({ dwarf: "[Scottish accent]" }, null);

    const settings = await readSettings();
    expect(settings.config.raceTags).toEqual({ dwarf: "[Scottish accent]" });
  });

  // The row has to be created to hold a tag, and creating it overrides everything else too.
  // Whatever the file says at that moment is what gets pinned, so it must be exactly that
  // and not some other default.
  it("pins the committed settings when it has to create the row", async () => {
    // Stated rather than assumed. afterEach restores the row this database generates with,
    // so a developer machine reaches this case with one already there -- and the case then
    // watches an update and calls it a creation, which is how it passed on CI and failed
    // on anyone's laptop.
    await noRow();
    await writeRaceTags({ dwarf: "[Scottish accent]" }, null);

    const settings = await readSettings();
    expect(settings.source).toBe("database");
    expect(settings.config.modelId).toBe(settings.defaults.modelId);
    expect(settings.config.voiceSettings).toEqual(settings.defaults.voiceSettings);
  });

  it("leaves the rest of an existing row alone", async () => {
    await writeRaceTags({}, null);
    await db().query(
      `update "generation_setting" set "modelId" = 'eleven_flash_v2_5', "seedStrategy" = 'none' where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );

    await writeRaceTags({ orc: "[gruff]" }, null);

    const settings = await readSettings();
    expect(settings.config.modelId).toBe("eleven_flash_v2_5");
    expect(settings.config.seedStrategy).toBe("none");
    expect(settings.config.raceTags).toEqual({ orc: "[gruff]" });
  });

  it("clears every tag when given an empty map", async () => {
    await writeRaceTags({ dwarf: "[Scottish accent]" }, null);
    await writeRaceTags({}, null);

    expect((await readSettings()).config.raceTags).toEqual({});
  });
});

describe("validateRaceTags", () => {
  it("is the same check the whole-config path applies", () => {
    expect(validateRaceTags({ dwarf: " [Scottish accent] " })).toEqual({
      dwarf: "[Scottish accent]",
    });
    expect(() => validateRaceTags({ dwarf: "<Scottish>" })).toThrow(SettingsError);
    expect(() => validateRaceTags("dwarf")).toThrow(SettingsError);
  });
});

describe("another language's settings", () => {
  it("follow English's, without its accent tags, until the language saves its own", async () => {
    await writeRaceTags({ dwarf: "[Scottish accent]" }, null);
    const english = await readSettings();
    const italian = await readSettings("koKR");

    expect(italian.source).toBe("english");
    expect(italian.config.modelId).toBe(english.config.modelId);
    expect(italian.config.raceTags).toEqual({});
  });

  it("are its own once saved, and English does not move", async () => {
    const before = await readSettings();
    await writeRaceTags({ orc: "[gruff]" }, null, "koKR");

    expect((await readSettings("koKR")).source).toBe("database");
    expect((await readSettings("koKR")).config.raceTags).toEqual({ orc: "[gruff]" });
    expect((await readSettings()).config).toEqual(before.config);
  });
});
