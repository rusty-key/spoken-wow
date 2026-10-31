/**
 * The fish.audio rate, against the real take table it is learned from.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { observedFishRate } = await import("./calibration");

/** A model no real take names, so the rows here are the only ones it can learn from. */
const MODEL = "test-calibration-fish";
const FILE = "gossip/calibration-test.mp3";

afterEach(async () => {
  await db().query(`delete from "take" where "file" = $1`, [FILE]);
});

afterAll(async () => {
  await closeDb();
});

describe("a fish.audio rate", () => {
  it("is list price at the script's widest until anything is learned", async () => {
    const english = await observedFishRate("s2.1-pro", "enUS");
    const korean = await observedFishRate("s2.1-pro", "koKR");
    // Only when no real s2.1-pro take exists in the database this runs against.
    if (english.samples === 0) expect(english.rate).toBeCloseTo(15 / 1_000_000);
    if (korean.samples === 0) expect(korean.rate).toBeCloseTo((15 / 1_000_000) * 3);
    expect(english).toMatchObject({ unit: "usd", modelId: "s2.1-pro" });
  });

  it("is free on the free model", async () => {
    const free = await observedFishRate("s2.1-pro-free", "deDE");
    if (free.samples === 0) expect(free.rate).toBe(0);
    expect(free.unknown).toBeFalsy();
  });

  it("is unknown for a model with no published price", async () => {
    expect(await observedFishRate("drama-3", "enUS")).toMatchObject({
      unknown: true,
      samples: 0,
    });
  });

  it("is learned from what fish.audio takes in that language cost", async () => {
    for (const [version, characters, usd] of [
      [1, 100, 0.003],
      [2, 300, 0.009],
    ]) {
      await db().query(
        `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin",
                             "bytes", "characters", "modelId", "provider", "costUsd", "teamId")
         values ('quests', 'ruRU', $1, 'g:calibration', $2, $3, 'generated', 1, $4, $5, 'fish', $6,
                 (select "teamId" from "team_language" where "lang" = 'ruRU' and "privileged"))`,
        [FILE, version, version === 2, characters, MODEL, usd],
      );
    }
    const learned = await observedFishRate(MODEL, "ruRU");
    expect(learned).toMatchObject({ unit: "usd", samples: 2 });
    expect(learned.rate).toBeCloseTo(0.012 / 400);
    // Another language learns nothing from Russian's bytes.
    expect((await observedFishRate(MODEL, "koKR")).samples).toBe(0);
  });
});
