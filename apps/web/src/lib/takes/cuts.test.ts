import { describe, expect, it } from "vitest";

import { CUTS, chooseCuts, chooseTimedCuts, parseSilences, sentenceStarts, WORD_LEAD, type CutSettings } from "./cuts";

// Scott White's cases from the pack converter of PR #942 (pipelines/quests/tests/test_pieces.py).
const PLAIN: CutSettings = { ...CUTS, minPause: 0, maxPiece: 0, fallbackPause: 0 };
const round3 = (seconds: number) => Math.round(seconds * 1000) / 1000;

describe("chooseCuts", () => {
  it("cuts in the middle of each pause", () => {
    expect(chooseCuts([[3.0, 3.6], [8.0, 8.5]], 12, PLAIN)).toEqual([3.3, 8.25]);
  });

  it("keeps a short sentence with the next", () => {
    expect(chooseCuts([[0.8, 1.2], [5.0, 5.6]], 10, PLAIN)).toEqual([5.3]);
  });

  it("keeps a short tail on the piece before", () => {
    expect(chooseCuts([[4.0, 4.6], [9.0, 9.5]], 10, PLAIN)).toEqual([4.3]);
  });

  it("leaves a line without pauses whole", () => {
    expect(chooseCuts([], 30)).toEqual([]);
  });

  it("cuts a piece too long again at its longest shorter pause", () => {
    const pauses: [number, number][] = [[3.0, 3.6], [8.0, 8.3], [14.0, 14.35], [20.0, 20.3]];
    expect(chooseCuts(pauses, 25)).toEqual([3.3, 14.175]);
  });

  it("does not take short pauses alone for sentence ends", () => {
    expect(chooseCuts([[4.0, 4.3]], 10)).toEqual([]);
  });

  it("can turn the second cut off", () => {
    expect(chooseCuts([[3.0, 3.6], [14.0, 14.35]], 25, { ...CUTS, fallbackPause: 0 })).toEqual([3.3]);
  });
});

describe("sentenceStarts", () => {
  it("starts a sentence after a full stop, question or exclamation", () => {
    expect(sentenceStarts("One two. Three four? Five six! Seven").sentences).toEqual([2, 4, 6]);
  });

  it("ends no sentence at an abbreviation or an initial", () => {
    expect(sentenceStarts("Ask Mr. Smith and J. Doe. Then go").sentences).toEqual([6]);
  });

  it("keeps an ellipsis before a lower case word inside its sentence", () => {
    expect(sentenceStarts("I think... maybe not. Go").sentences).toEqual([4]);
  });

  it("starts a sentence at a paragraph, whatever ends the one before", () => {
    expect(sentenceStarts("Hear me\n\nfriend").sentences).toEqual([2]);
  });

  it("looks through quotes around a stop or a word", () => {
    expect(sentenceStarts('He said "Go." "Wait," she cried').sentences).toEqual([3]);
  });

  it("starts clauses at commas, semicolons, colons and dashes", () => {
    expect(sentenceStarts("One, two; three: four — five").clauses).toEqual([1, 2, 3, 5]);
  });
});

const SAID = "One two three. Four five six. Seven eight nine.";
const SAID_TIMES = [0, 0.5, 1, 2.5, 3, 3.5, 5, 5.5, 6];

describe("chooseTimedCuts", () => {
  it("cuts just before each sentence's first word", () => {
    expect(chooseTimedCuts(SAID, SAID_TIMES, 7.5)).toEqual([round3(2.5 - WORD_LEAD), round3(5 - WORD_LEAD)]);
  });

  it("never cuts nearer the word before than halfway", () => {
    expect(chooseTimedCuts("One. Two", [0, 0.3], 1, { ...CUTS, minPiece: 0, minTail: 0 })).toEqual([0.15]);
  });

  it("keeps a short sentence with the next", () => {
    expect(chooseTimedCuts(SAID, [0, 0.3, 0.6, 1, 1.3, 1.6, 5, 5.5, 6], 7.5)).toEqual([round3(5 - WORD_LEAD)]);
  });

  it("gives up on times that do not fit the text, so the line is measured", () => {
    expect(chooseTimedCuts(SAID, SAID_TIMES.slice(0, -1), 7.5)).toBeNull();
    expect(chooseTimedCuts(SAID, [0, 0.5, 1, 2.5, 2, 3.5, 5, 5.5, 6], 7.5)).toBeNull();
    expect(chooseTimedCuts(SAID, SAID_TIMES, 6)).toBeNull();
    expect(chooseTimedCuts("", [], 6)).toBeNull();
  });

  it("cuts a piece too long at the clause whose words are furthest apart", () => {
    // Two clauses would each do: the one at 9.5 s is nearer the middle, but the pause before the
    // one at 11.5 s is longer, as its words' starts 1.5 s apart say.
    const words = Array.from({ length: 20 }, (_, i) => (i === 9 || i === 11 ? `w${i},` : `w${i}`)).join(" ");
    const times = [...Array.from({ length: 10 }, (_, i) => i), 9.75, 10.25, 11.75, ...Array.from({ length: 7 }, (_, i) => 12.5 + i)];
    expect(chooseTimedCuts(words, times, 20)).toEqual([11.5]);
    expect(chooseTimedCuts(words, times, 20, { ...CUTS, fallbackPause: 0 })).toEqual([]);
  });
});

describe("parseSilences", () => {
  it("drops a pause still open at the end", () => {
    const log =
      "[silencedetect @ 0x1] silence_start: 3.1\n" +
      "[silencedetect @ 0x1] silence_end: 3.7 | silence_duration: 0.6\n" +
      "[silencedetect @ 0x1] silence_start: 9.9\n";
    expect(parseSilences(log)).toEqual([[3.1, 3.7]]);
  });

  it("clamps a pause at the very start to zero", () => {
    expect(parseSilences("silence_start: -0.01\nsilence_end: 0.5 | silence_duration: 0.51\n")).toEqual([[0, 0.5]]);
  });
});
