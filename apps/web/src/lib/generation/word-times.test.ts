import { describe, expect, it } from "vitest";

import { timesFor, wordStarts, type WordStart } from "./word-times";

/** An alignment of `text`, each character 0.1s after the one before. */
function alignmentOf(text: string) {
  const characters = [...text];
  return { characters, character_start_times_seconds: characters.map((_, index) => index / 10) };
}

const at = (pairs: [string, number][]): WordStart[] => pairs.map(([word, start]) => ({ word, start }));

describe("wordStarts", () => {
  it("starts each word at its first character", () => {
    expect(wordStarts(alignmentOf("Well then,  you"))).toEqual(
      at([["Well", 0], ["then,", 0.5], ["you", 1.2]]),
    );
  });

  // ElevenLabs times a direction as though it were said, and the addon never shows one.
  it("leaves out bracketed tags, a word touching one included", () => {
    const words = wordStarts(alignmentOf("[Scottish accent] Warsong [sighs]Gulch"));
    expect(words.map((word) => word.word)).toEqual(["Warsong", "Gulch"]);
  });

  it("breaks a word where a dialogue turn starts", () => {
    const words = wordStarts(alignmentOf("there.He waves."), [0, 6]);
    expect(words.map((word) => word.word)).toEqual(["there.", "He", "waves."]);
  });
});

describe("timesFor", () => {
  const spoken = at([["Hello", 0.2], ["adventurer.", 0.61234]]);

  it("gives each shown word its spoken word's start, whatever the spelling", () => {
    // $N is spoken as a word of its own; a pronunciation rule respells and keeps the count.
    expect(timesFor("Hello $N.", spoken)).toEqual([0.2, 0.612]);
  });

  // Times shifted by one word light the wrong word to the end of the line; none is estimated.
  it("keeps none when the counts differ", () => {
    expect(timesFor("Hello there, $N.", spoken)).toBeNull();
    expect(timesFor("Hello.", at([["Hel", 0], ["lo", 0.1], ["there", 0.3]]))).toBeNull();
    expect(timesFor("   ", spoken)).toBeNull();
  });

  it("finds a book's page after the title it was read with", () => {
    const read = at([["A", 0], ["Dusty", 0.2], ["Tome.", 0.5], ["The", 1.4], ["end.", 1.6]]);
    expect(timesFor("The end.", read)).toEqual([1.4, 1.6]);
    expect(timesFor("Not this.", read)).toBeNull();
  });

  it("starts nothing before the file does", () => {
    expect(timesFor("Hi", at([["Hi", -0.04]]))).toEqual([0]);
  });
});
