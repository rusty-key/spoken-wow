import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import { loadRoster } from "./roster-store";
import { isModelVoice, voiceName } from "./voices";

describe("the roster", () => {
  // The roster is what /voices, the filters and the triage selects offer, so a corpus line
  // outside it would be spoken in a voice nothing can find or clone.
  it("covers every voice the corpus speaks in", async () => {
    const roster = await loadRoster();
    for (const line of (await corpus()).lines) {
      // An NPC with no type, or one the game gives no flavor, speaks in none until somebody
      // answers for it: its line is marked no-voice and waits.
      const waiting = line.skipReason === "no-voice";
      expect(roster.isVoice(line.voice) || waiting, line.voice).toBe(true);
    }
  });

  it("does not mix a bare voice with flavored ones for the same race-gender", async () => {
    const { data } = await loadRoster();
    for (const a of data.assignments) {
      if (a.flavor !== null) continue;
      const flavored = data.assignments.some((b) => b.race === a.race && b.gender === a.gender && b.flavor !== null);
      // A genderless generic type is read by one voice whatever its flavor; a race-gender is not.
      if (a.gender !== null) expect(flavored, `${a.race}-${a.gender}`).toBe(false);
    }
  });

  it("keeps model slots off it", async () => {
    const roster = await loadRoster();
    expect(roster.isVoice("model-29")).toBe(true);
    expect(roster.voiceNames.some(isModelVoice)).toBe(false);
    for (const name of ["model-", "model-29-male", "model-../x", "orc-model-29"]) {
      expect(roster.isVoice(name), name).toBe(false);
    }
  });
});

describe("voiceName", () => {
  it("names a model slot by itself, as flavors.py's voice_name does", () => {
    expect(voiceName({ race: "model-29", gender: "male", flavor: null })).toBe("model-29");
    expect(voiceName({ race: "tauren", gender: "male", flavor: "warrior" })).toBe("tauren-male-warrior");
    expect(voiceName({ race: "narrator", gender: "male", flavor: null })).toBe("narrator-male");
  });
});
