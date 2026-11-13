/**
 * The rule, with no database: dirtiness is a comparison between three plain facts -- when a
 * take was made, when a word's pronunciation last moved, and whether anyone has said the
 * take is fine since. Everything that reads Postgres is loadDirtyContext, a pair of selects,
 * tested against a real database in dirty-context.test.ts.
 */
import { describe, expect, it } from "vitest";

import { dirtyFiles, soundChanges, type DirtyContext } from "./dirty";

const DAY = 24 * 60 * 60 * 1000;
const monday = Date.parse("2026-09-14T00:00:00Z");

function context(partial: Partial<DirtyContext> = {}): DirtyContext {
  return { changes: [], acks: new Map(), ...partial };
}

describe("dirtyFiles", () => {
  it("marks a take made before a change to a word it speaks", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday }],
      context({ changes: [{ grapheme: "Tauren", changedAt: monday + DAY }] }),
    );
    expect([...dirty]).toEqual(["quests/1.mp3"]);
  });

  it("leaves a take made after the change alone", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday + 2 * DAY }],
      context({ changes: [{ grapheme: "Tauren", changedAt: monday + DAY }] }),
    );
    expect(dirty.size).toBe(0);
  });

  it("ignores a change to a word the line does not say", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday }],
      context({ changes: [{ grapheme: "Gnomeregan", changedAt: monday + DAY }] }),
    );
    expect(dirty.size).toBe(0);
  });

  it("matches whole words only, so Taurenoid is not a tauren", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "A taurenoid creature.", generatedAt: monday }],
      context({ changes: [{ grapheme: "Tauren", changedAt: monday + DAY }] }),
    );
    expect(dirty.size).toBe(0);
  });

  it("matches across the punctuation a name is written with", () => {
    // Aku'mai is one word to a reader and two to \b, and the possessive is how half the
    // corpus writes a name: both have to match, or the entry that fixed them does nothing.
    const dirty = dirtyFiles(
      [
        { file: "a.mp3", text: "Beware Aku'mai!", generatedAt: monday },
        { file: "b.mp3", text: "The tauren's hut.", generatedAt: monday },
      ],
      context({
        changes: [
          { grapheme: "Aku'mai", changedAt: monday + DAY },
          { grapheme: "Tauren", changedAt: monday + DAY },
        ],
      }),
    );
    expect([...dirty].sort()).toEqual(["a.mp3", "b.mp3"]);
  });

  it("an acknowledgement from after the change clears it", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday }],
      context({
        changes: [{ grapheme: "Tauren", changedAt: monday + DAY }],
        acks: new Map([["quests/1.mp3", monday + 2 * DAY]]),
      }),
    );
    expect(dirty.size).toBe(0);
  });

  it("a later edit to the same word re-dirties a take already cleared", () => {
    // The judgement was made against the rules as they stood, and the rules moved again.
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday }],
      context({
        changes: [
          { grapheme: "Tauren", changedAt: monday + DAY },
          { grapheme: "Tauren", changedAt: monday + 3 * DAY },
        ],
        acks: new Map([["quests/1.mp3", monday + 2 * DAY]]),
      }),
    );
    expect([...dirty]).toEqual(["quests/1.mp3"]);
  });

  it("says nothing about a take whose date is unknown", () => {
    // Inherited and imported audio has no generatedAt. Unknown is not "before": calling
    // every inherited file dirty would mark most of the store on a claim nothing supports.
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: null }],
      context({ changes: [{ grapheme: "Tauren", changedAt: monday + DAY }] }),
    );
    expect(dirty.size).toBe(0);
  });

  it("is case-insensitive in both directions", () => {
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "THE TAUREN WAIT.", generatedAt: monday }],
      context({ changes: [{ grapheme: "tauren", changedAt: monday + DAY }] }),
    );
    expect([...dirty]).toEqual(["quests/1.mp3"]);
  });

  it("costs one pass per changed word, not one per entry in the lexicon", () => {
    // A sweep over the whole corpus is the filter's normal case, so the loop must be over
    // what changed rather than over what exists. A take older than nothing is clean without
    // its text ever being read.
    const changes = [{ grapheme: "Tauren", changedAt: monday - DAY }];
    const dirty = dirtyFiles(
      [{ file: "quests/1.mp3", text: "The tauren are waiting.", generatedAt: monday }],
      context({ changes }),
    );
    expect(dirty.size).toBe(0);
  });
});

describe("soundChanges", () => {
  const tauren = { grapheme: "Tauren", ipa: "ˈtɔːɹən", confidence: "check" as const };

  it("reports an entry that is new", () => {
    expect(soundChanges([], [tauren])).toEqual([
      { grapheme: "Tauren", kind: "added", after: "/ˈtɔːɹən/" },
    ]);
  });

  it("reports an entry that is gone", () => {
    // A removal changes how the word sounds as much as an addition does: takes made while
    // the rule stood no longer match what would be spoken today.
    expect(soundChanges([tauren], [])).toEqual([
      { grapheme: "Tauren", kind: "removed", before: "/ˈtɔːɹən/" },
    ]);
  });

  it("reports a respelling, and a switch between IPA and alias", () => {
    expect(soundChanges([tauren], [{ ...tauren, ipa: "ˈtaʊɹən" }])).toEqual([
      { grapheme: "Tauren", kind: "edited", before: "/ˈtɔːɹən/", after: "/ˈtaʊɹən/" },
    ]);
    expect(
      soundChanges([tauren], [{ grapheme: "Tauren", alias: "toren", confidence: "check" }]),
    ).toEqual([{ grapheme: "Tauren", kind: "edited", before: "/ˈtɔːɹən/", after: "toren" }]);
  });

  it("says nothing about a note or a confidence, which nothing hears", () => {
    // These are the fields the page is mostly edited for. Marking audio dirty because
    // somebody wrote down WHY an entry exists would make the mark worthless.
    expect(soundChanges([tauren], [{ ...tauren, note: "silent nothing", confidence: "high" }])).toEqual(
      [],
    );
  });

  it("says nothing about a save that changed no word", () => {
    expect(soundChanges([tauren], [tauren])).toEqual([]);
  });

  it("follows the word through a change of case, because matching ignores case", () => {
    // 'tauren' and 'Tauren' are one entry to ElevenLabs and to the matcher above, so a
    // re-capitalised grapheme is not an addition and a removal.
    expect(soundChanges([tauren], [{ ...tauren, grapheme: "tauren" }])).toEqual([]);
  });
});
