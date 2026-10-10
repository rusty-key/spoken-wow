import { describe, expect, it } from "vitest";

import { corpus as catalogue } from "./quests/catalogue";
import { facets as readFacets } from "./facets";
import { loadRoster } from "./voices/roster-store";
import { isModelVoice } from "./voices/voices";

const corpus = await catalogue();
const facets = await readFacets();
const roster = await loadRoster();

describe("facets", () => {
  it("offers every value the corpus actually uses", () => {
    // voices.test.ts keeps the corpus inside the roster; this is the filter bar's side of it.
    // Except a line with no voice chosen yet -- a model slot's (voices.ts isModelVoice), or one
    // whose NPC the game gives no flavor (migration 0070) -- which is off the roster on purpose.
    for (const line of corpus.lines) {
      if (!roster.isVoice(line.voice) || isModelVoice(line.voice) || !line.race) continue;
      expect(facets.races).toContain(line.race);
      // A genderless type's lines have none to offer.
      if (line.gender) expect(facets.genders).toContain(line.gender);
      expect(facets.voices).toContain(line.voice);
      if (line.flavor) expect(facets.flavors).toContain(line.flavor);
    }
  });

  it("offers the roster, including voices no line uses yet", () => {
    expect(facets.races).toEqual(roster.races);
    expect(facets.voices).toEqual(roster.voiceNames);
    // So the voice and flavor filters can reach the slots /voices shows for it.
    expect(facets.voices).toContain("skybourneelf-female-3774");
    expect(facets.flavorScopes).toContainEqual({ race: "skybourneelf", gender: "female", flavor: "3774" });
  });

  // narrator-male and bloodelf-female have no NPC voice sets, so their lines carry no
  // flavor - and a blank entry in the dropdown would filter to nothing selectable.
  it("leaves out the lines with no flavor", () => {
    expect(corpus.lines.some((l) => l.flavor === null)).toBe(true);
    expect(facets.flavors).not.toContain(null);
    expect(facets.flavors.every((f) => f.length > 0)).toBe(true);
  });

  // What lets the flavor dropdown narrow to a chosen race and gender: only tauren, troll and
  // orc have a shaman voice, and offering the other forty-nine flavors against tauren would
  // mostly offer ways to select nothing.
  describe("flavorScopes", () => {
    it("pairs every flavored line's race, gender and flavor", () => {
      const keys = new Set(facets.flavorScopes.map((s) => `${s.race}-${s.gender}-${s.flavor}`));
      for (const line of corpus.lines) {
        if (line.flavor) expect(keys).toContain(`${line.race}-${line.gender}-${line.flavor}`);
      }
    });

    it("pairs nothing the roster does not", () => {
      const keys = new Set(roster.data.flavors.map((v) => `${v.race}-${v.gender ?? ""}-${v.flavor}`));
      expect(facets.flavorScopes).toHaveLength(keys.size);
      for (const scope of facets.flavorScopes) {
        expect(keys).toContain(`${scope.race}-${scope.gender}-${scope.flavor}`);
      }
    });

    it("narrows a race-gender to the flavors it actually has", () => {
      const under = (race: string, gender: string) =>
        facets.flavorScopes
          .filter((s) => s.race === race && s.gender === gender)
          .map((s) => s.flavor);

      expect(under("orc", "female").sort()).toEqual(["shaman", "standard", "warrior"]);
      // The one race-gender with a single voice, and the one with no standard.
      expect(under("goblin", "female")).toEqual(["zany"]);
      expect(under("tauren", "male")).not.toContain("standard");
    });
  });

  it("is deduplicated and sorted, because it is rendered as-is", () => {
    for (const values of [facets.races, facets.genders, facets.flavors, facets.voices]) {
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    }
  });
});
