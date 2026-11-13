import { describe, expect, it } from "vitest";

import {
  accentTagged,
  bareDirection,
  directionFor,
  audioTags,
  hasNarration,
  restoresOnlyNarration,
  segments,
  voiceAfter,
} from "./narration";

describe("audioTags", () => {
  it("turns a lowercase sound into the tag syntax ElevenLabs performs", () => {
    expect(audioTags("Take some coin... <hic>... some new armor")).toBe(
      "Take some coin... [hic]... some new armor",
    );
  });

  it("converts every sound in a line", () => {
    expect(audioTags("Ye're brave... <cough>... fer me. <cough>")).toBe(
      "Ye're brave... [cough]... fer me. [cough]",
    );
  });

  it("leaves a capitalised direction alone, because the narrator reads it", () => {
    expect(audioTags("Hm. <cough> <He turns away.>")).toBe("Hm. [cough] <He turns away.>");
  });

  it("leaves an unbalanced bracket alone rather than guessing", () => {
    expect(audioTags("What < is this")).toBe("What < is this");
  });
});

describe("segments", () => {
  it("splits speech from a trailing direction", () => {
    expect(segments("Excellent.\n\n<He opens the note.>")).toEqual([
      { speaker: "npc", text: "Excellent." },
      { speaker: "narrator", text: "He opens the note." },
    ]);
  });

  it("keeps reading order when a direction comes first", () => {
    expect(segments("<Sirra begins translating.>\n\nThere we are.")).toEqual([
      { speaker: "narrator", text: "Sirra begins translating." },
      { speaker: "npc", text: "There we are." },
    ]);
  });

  it("handles a line that is nothing but a direction", () => {
    expect(segments("<Sirra begins translating the note...>")).toEqual([
      { speaker: "narrator", text: "Sirra begins translating the note..." },
    ]);
  });

  it("alternates through more than one direction", () => {
    const parts = segments("One. <A pause.> Two. <A longer pause.>");
    expect(parts.map((p) => p.speaker)).toEqual(["npc", "narrator", "npc", "narrator"]);
  });

  it("returns one npc segment when there is no direction", () => {
    expect(segments("Just talking.")).toEqual([{ speaker: "npc", text: "Just talking." }]);
  });

  it("leaves an unbalanced bracket in the spoken text rather than guessing", () => {
    // The gate refuses this line anyway; inventing a closing bracket here would hide that.
    expect(segments("What < is this")).toEqual([{ speaker: "npc", text: "What < is this" }]);
  });

  it("leaves a lowercase sound with the npc", () => {
    // <hic> is the dwarf hiccuping, not the game narrating. Handing it to a narrator would have
    // a second voice say "hic". audioTags has usually turned it into [hic] before this runs;
    // either way it stays in the NPC's own turn.
    expect(segments("Take some coin... <hic>... some new armor")).toEqual([
      { speaker: "npc", text: "Take some coin... <hic>... some new armor" },
    ]);
  });

  it("splits on the capital, not on the bracket", () => {
    // Capitalisation is the whole rule: a direction names someone, a sound does not.
    expect(segments("Hm. <cough> <He turns away.>")).toEqual([
      { speaker: "npc", text: "Hm. <cough>" },
      { speaker: "narrator", text: "He turns away." },
    ]);
  });

  it("keeps a direction with no full stop, which the corpus has", () => {
    // "Motega shrugs his shoulder" is why the rule is capitalisation and not punctuation.
    expect(segments("<Motega shrugs his shoulder>")).toEqual([
      { speaker: "narrator", text: "Motega shrugs his shoulder" },
    ]);
  });

  it("drops whitespace-only pieces", () => {
    expect(segments("  <A pause.>  ")).toEqual([{ speaker: "narrator", text: "A pause." }]);
  });
});

describe("hasNarration", () => {
  it("is true only for a capitalised, well-formed direction", () => {
    expect(hasNarration("Hello <He waves.> there")).toBe(true);
    expect(hasNarration("Hello there")).toBe(false);
    expect(hasNarration("What < is this")).toBe(false);
    expect(hasNarration("Ye're brave... <cough>...")).toBe(false);
  });
});

describe("restoresOnlyNarration", () => {
  const corpus = "A crystal fragment.";

  it("is true when only a direction was put back", () => {
    expect(restoresOnlyNarration("<He turns it over.>\n\nA crystal fragment.", corpus)).toBe(true);
  });

  it("is false when a word changed as well", () => {
    expect(restoresOnlyNarration("<He turns it over.>\n\nA crystal shard.", corpus)).toBe(false);
  });

  it("is false for an ordinary rewrite with no direction at all", () => {
    // The rewrites worth reviewing: a $ token turned into words, "adventurerama", the line
    // that is the single letter "x".
    expect(restoresOnlyNarration("Plenty of leather.", corpus)).toBe(false);
  });

  it("ignores whitespace, which the strip leaves behind unevenly", () => {
    expect(restoresOnlyNarration("<He turns it over.>   A crystal   fragment.", corpus)).toBe(true);
  });
});

describe("accentTagged", () => {
  it("prefixes the tag to a plain line", () => {
    expect(accentTagged("Welcome to Ironforge.", "[Scottish accent]")).toBe(
      "[Scottish accent] Welcome to Ironforge.",
    );
  });

  it("leaves the line alone when the race has no tag", () => {
    expect(accentTagged("Welcome to Ironforge.", undefined)).toBe("Welcome to Ironforge.");
  });

  it("tags the speech but not the direction the narrator reads", () => {
    expect(accentTagged("Excellent.\n\n<He opens the note.>", "[Scottish accent]")).toBe(
      "[Scottish accent] Excellent.\n\n<He opens the note.>",
    );
  });

  it("tags every stretch of speech a direction interrupts", () => {
    expect(accentTagged("Aye. <He nods.> Off with ye.", "[Scottish accent]")).toBe(
      "[Scottish accent] Aye. <He nods.> [Scottish accent] Off with ye.",
    );
  });

  it("keeps a sound already rewritten by audioTags with the speech that makes it", () => {
    expect(accentTagged("Take some coin... [hic]", "[Scottish accent]")).toBe(
      "[Scottish accent] Take some coin... [hic]",
    );
  });

  it("leaves an unbalanced bracket as damage for the gate to refuse", () => {
    expect(accentTagged("What < is this", "[Scottish accent]")).toBe(
      "[Scottish accent] What < is this",
    );
  });
});

describe("voice markers", () => {
  const wizbang = [
    "A tiny voice crackles from deep within the machine.",
    "",
    "_goblin-male-zany_",
    '"Wizbang here! <Static fills the line.> *Hic*... What? No, I\'m fine!"',
  ].join("\n");

  it("hands the rest of the line to the marked slot, directions still to the narrator", () => {
    expect(segments(wizbang)).toEqual([
      { speaker: "npc", text: "A tiny voice crackles from deep within the machine." },
      { speaker: "npc", voice: "goblin-male-zany", text: '"Wizbang here!' },
      { speaker: "narrator", text: "Static fills the line." },
      { speaker: "npc", voice: "goblin-male-zany", text: '*Hic*... What? No, I\'m fine!"' },
    ]);
  });

  it("switches again at the next marker", () => {
    expect(segments("_gnome-female-1_ One. _narrator-male_ Two.")).toEqual([
      { speaker: "npc", voice: "gnome-female-1", text: "One." },
      { speaker: "npc", voice: "narrator-male", text: "Two." },
    ]);
  });

  it("is not a marker inside a word, or without a hyphen", () => {
    expect(segments("snake_case-thing_ and _emphasis_ stay words.")).toEqual([
      { speaker: "npc", text: "snake_case-thing_ and _emphasis_ stay words." },
    ]);
  });

  it("is not narration", () => {
    expect(hasNarration("_goblin-male-zany_ Hello.")).toBe(false);
  });

  it("gives a marked stretch its own race's accent", () => {
    const tags = { dwarf: "[Scottish accent]", goblin: "[fast, nasal]" };
    expect(accentTagged("Aye. _goblin-male-zany_ Wizbang here!", tags.dwarf, tags)).toBe(
      "[Scottish accent] Aye. _goblin-male-zany_ [fast, nasal] Wizbang here!",
    );
  });

  it("gives a marked stretch its own flavor's direction after its race's", () => {
    const tags = { goblin: "[fast, nasal]", "goblin-male-zany": "[manic]" };
    expect(accentTagged("Hm. _goblin-male-zany_ Wizbang here!", undefined, tags)).toBe(
      "Hm. _goblin-male-zany_ [fast, nasal] [manic] Wizbang here!",
    );
  });

  it("leaves a stretch untagged when the marked race has no direction", () => {
    expect(accentTagged("Aye. _narrator-male_ He left.", "[Scottish accent]", {})).toBe(
      "[Scottish accent] Aye. _narrator-male_ He left.",
    );
  });

  it("reports who is speaking at the end, for the next paragraph", () => {
    expect(voiceAfter("Hi. _goblin-male-zany_ Yo.")).toBe("goblin-male-zany");
    expect(voiceAfter("Still going.", "goblin-male-zany")).toBe("goblin-male-zany");
    expect(voiceAfter("Plain.")).toBeUndefined();
  });
});

describe("directionFor", () => {
  const tags = { dwarf: "[Scottish accent]", "dwarf-female-young": "[girlish]", "gnome-male-young": "[boyish]" };

  it("is the race's direction for a flavor with none of its own", () => {
    expect(directionFor("dwarf-male-grim", tags)).toBe("[Scottish accent]");
  });

  it("adds a flavor's direction after its race's", () => {
    expect(directionFor("dwarf-female-young", tags)).toBe("[Scottish accent] [girlish]");
  });

  it("is a flavor's own direction when its race has none", () => {
    expect(directionFor("gnome-male-young", tags)).toBe("[boyish]");
    expect(directionFor("gnome-male-zany", tags)).toBeUndefined();
  });

  it("does not read a race's direction twice for a slot named by the race alone", () => {
    expect(directionFor("dwarf", tags)).toBe("[Scottish accent]");
  });
});

describe("bareDirection", () => {
  it("drops the brackets around a stored direction", () => {
    expect(bareDirection("[Scottish accent]")).toBe("Scottish accent");
    expect(bareDirection(" [ boyish ] ")).toBe("boyish");
  });

  it("leaves a bare direction, and one that is not a single span, as they are", () => {
    expect(bareDirection("Scottish accent")).toBe("Scottish accent");
    expect(bareDirection("[fast] [nasal]")).toBe("[fast] [nasal]");
  });
});
