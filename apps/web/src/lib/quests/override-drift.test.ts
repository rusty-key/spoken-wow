/**
 * The original text is mocked because the corpus changes only through an import.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CorpusLine } from "@/lib/corpus";

const originals = vi.hoisted(() => new Map<string, { text: string }>());

vi.mock("@/lib/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audio")>()),
  fileIndex: async () => originals as unknown as Map<string, CorpusLine>,
}));

import { closeDb } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { hasDrifted } from "./override-drift";
import { readOverrides, writeOverride } from "./overrides";

let file: string;

beforeEach(() => {
  file = `quests/test-drift-${Math.random().toString(36).slice(2, 10)}.mp3`;
  originals.set(file, { text: "Text A." });
});

afterEach(async () => {
  originals.clear();
  await asSystem.query(`delete from "activity" where "subject" = $1`, [file]);
  await asSystem.query(`delete from "line_override" where "file" = $1`, [file]);
});

afterAll(closeDb);

const drifted = async () => hasDrifted((await readOverrides()).get(file), originals.get(file)!.text);

describe("hasDrifted, over what writeOverride stored", () => {
  it("leaves an override written over the current original alone", async () => {
    await writeOverride(file, "q:1:accept", "Mine.", null);
    expect(await drifted()).toBe(false);
  });

  it("names an override once the original under it changes", async () => {
    await writeOverride(file, "q:1:accept", "Mine.", null);
    originals.set(file, { text: "Text B." });
    expect(await drifted()).toBe(true);
  });

  it("clears when the override is saved again, until the original changes again", async () => {
    await writeOverride(file, "q:1:accept", "Mine.", null);
    originals.set(file, { text: "Text B." });
    await writeOverride(file, "q:1:accept", "Mine.", null);
    expect(await drifted()).toBe(false);
    originals.set(file, { text: "Text C." });
    expect(await drifted()).toBe(true);
  });

  it("never names a row with no hash", async () => {
    await asSystem.query(
      `insert into "line_override" ("teamId", "file", "lineId", "text") values (team_of_lang('enUS'), $1, 'q:1:accept', 'Old.')`,
      [file],
    );
    originals.set(file, { text: "Text B." });
    expect(await drifted()).toBe(false);
  });
});
