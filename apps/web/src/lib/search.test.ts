import { describe, expect, it } from "vitest";

import { npcKey } from "./corpus";
import { corpus as catalogue } from "./quests/catalogue";
import { batchJobs, isGap, matchingLines, search } from "./search";

const corpus = await catalogue();
/**
 * What the explorer means by "has audio" is a live take row, read per request and passed
 * in. These tests are about the pure search, so they hand it an empty set -- the same
 * shape, and the one that needs no database.
 */
const store = new Set<string>();
const find = (options: Parameters<typeof search>[2]) => search(corpus, store, options);
/**
 * The whole result rather than a page, for assertions about the match set itself.
 *
 * Every test using this is about some axis other than progress text, so it opts progress back
 * in: leaving it out would quietly turn each count into "...excluding progress", which is a
 * weaker fact than the one the test means to pin. The default has tests of its own below.
 */
const all = (options: Parameters<typeof search>[2] = {}) =>
  find({ includeProgress: true, ...options, limit: 20_000 }).lines;

/** The same, with the app's real defaults, for the tests that are about those defaults. */
const asShipped = (options: Parameters<typeof search>[2] = {}) =>
  find({ ...options, limit: 20_000 }).lines;

const npcKeys = (lines: { npcType: "creature" | "gameobject" | "item"; npcId: number }[]) =>
  [...new Set(lines.map(npcKey))].sort();

describe("search by npc", () => {
  it("finds an npc by name, case-insensitively", () => {
    // includeProgress so the total stays a fact about how many lines Dughan has, rather
    // than how many of them happen not to be progress text.
    const result = find({ q: "dughan", filter: "npc", includeProgress: true, limit: 20_000 });
    expect(npcKeys(result.lines)).toEqual(["creature:240"]);
    expect(result.npcCount).toBe(1);
    expect(result.total).toBe(22);
  });

  it("finds the same npc by id", () => {
    const byId = find({ q: "240", filter: "npc", limit: 20_000 });
    expect(npcKeys(byId.lines)).toEqual(["creature:240"]);
    expect(byId.total).toBe(find({ q: "dughan", filter: "npc" }).total);
  });

  it("matches on a substring, not just a prefix", () => {
    expect(all({ q: "MARSHAL", filter: "npc" }).some((l) => l.npcId === 240)).toBe(true);
  });

  it("is widened by 'any', which also reads what other npcs say about them", () => {
    // The scope dropdown exists for exactly this: "dughan" unscoped now brings in lines that
    // merely mention him, which is usually welcome and occasionally not.
    expect(all({ q: "dughan" }).length).toBeGreaterThan(all({ q: "dughan", filter: "npc" }).length);
  });
});

describe("search by quest", () => {
  it("finds every giver of a quest id", () => {
    // Quest 123 "The Collector" is accepted from an item and turned in to an NPC - the
    // case the old data-module format could not express.
    expect(npcKeys(all({ q: "123", filter: "quest" }))).toEqual(["creature:240", "item:1307"]);
  });

  it("finds a quest by title", () => {
    expect(npcKeys(all({ q: "The Collector", filter: "quest" }))).toEqual([
      "creature:240",
      "item:1307",
    ]);
  });
});

describe("search by line text", () => {
  // A phrase from one line of Marshal Dughan's, and from nothing else in the corpus. His
  // name is what makes it a real test of scoping: an npc-scoped search still finds his
  // other lines by name, so only a phrase absent from every name can prove text is read.
  const phrase = "murlocs are true";

  it("finds a line by what it says", () => {
    const lines = all({ q: phrase, filter: "text" });
    expect(lines.map((l) => l.lineId)).toEqual(["q:35:accept"]);
  });

  it("is included in 'any'", () => {
    expect(all({ q: phrase }).map((l) => l.lineId)).toEqual(["q:35:accept"]);
  });

  it("is not read by the npc or quest filters", () => {
    expect(all({ q: phrase, filter: "npc" })).toEqual([]);
    expect(all({ q: phrase, filter: "quest" })).toEqual([]);
  });

  it("treats a number as a substring rather than an id", () => {
    // The id branch is what "any" uses for a bare number, and it is deliberately not shared:
    // scoped to text, "12" means the characters, not quest 12.
    const lines = all({ q: "12", filter: "text" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.text.includes("12"))).toBe(true);
  });
});

describe("filter scoping", () => {
  it("'npc' does not match a quest id", () => {
    // No creature has id 123, so an npc-scoped search must come back empty.
    expect(all({ q: "123", filter: "npc" })).toEqual([]);
  });

  it("'any' matches either side", () => {
    expect(npcKeys(all({ q: "123" })).length).toBe(2);
    expect(all({ q: "240" }).some((l) => l.npcId === 240)).toBe(true);
  });
});

describe("field filters", () => {
  it("narrows to a race", () => {
    const lines = all({ race: "tauren" });
    expect(lines).toHaveLength(2064);
    expect(lines.every((l) => l.race === "tauren")).toBe(true);
  });

  it("intersects rather than widening", () => {
    const both = all({ race: "tauren", gender: "female" });
    expect(both).toHaveLength(630);
    expect(both.length).toBeLessThan(all({ race: "tauren" }).length);
    expect(both.every((l) => l.race === "tauren" && l.gender === "female")).toBe(true);
  });

  it("filters by voice, source and entity type", () => {
    // A voice is race-gender-flavor, so it narrows within the pair rather than matching it:
    // tauren-female speaks with three different voices.
    expect(all({ voice: "tauren-female-shaman" })).toHaveLength(145);
    expect(all({ voice: "tauren-female-shaman" }).every((l) => l.race === "tauren")).toBe(true);
    // A flavor cuts across races - three of them have a shaman voice - so it narrows on its
    // own axis rather than standing in for a voice.
    expect(all({ flavor: "shaman" })).toHaveLength(766);
    expect(all({ flavor: "shaman", race: "tauren" })).toHaveLength(416);
    expect(all({ source: "gossip" }).every((l) => l.source === "gossip")).toBe(true);
    expect(all({ npcType: "item" }).every((l) => l.npcType === "item")).toBe(true);
  });

  it("combines with a query", () => {
    const lines = all({ q: "dughan", filter: "npc", source: "gossip" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.npcId === 240 && l.source === "gossip")).toBe(true);
  });

  it("marks narrated lines voiceable even though the corpus gave up on them", () => {
    // The trap this pins: `generatable` is baked into the corpus and stays false for these
    // lines forever, because voicing them needed no corpus rebuild. Anything asking "can this
    // be generated?" must read `voiceable`. Reading the stale flag once disabled the
    // Regenerate button on precisely the lines the narrator exists for.
    const narrated = asShipped({ narration: true });
    expect(narrated.length).toBeGreaterThan(0);
    expect(narrated.some((l) => !l.generatable)).toBe(true);
    expect(narrated.every((l) => l.voiceable || l.source === "progress")).toBe(true);
  });

  it("narrows to lines a narrator would read", () => {
    const lines = asShipped({ narration: true });
    expect(lines.length).toBeGreaterThan(0);
    // Every one still carries its brackets, and none is a bare lowercase sound: <hic> is the
    // NPC hiccuping, not the game narrating, so it is not narration.
    expect(lines.every((l) => /<[A-Z][^<>]*>/.test(l.text))).toBe(true);
    expect(lines.some((l) => l.text.includes("<hic>"))).toBe(false);
  });

  it("hides progress text unless asked for", () => {
    // 3,096 of the corpus's 17,564 lines, and no code path will ever voice one.
    expect(asShipped().every((l) => l.source !== "progress")).toBe(true);
    expect(asShipped()).toHaveLength(14468);
    expect(all()).toHaveLength(17564);
  });

  it("treats asking for the progress source as asking to see them", () => {
    // Otherwise picking `progress` in the source filter would return nothing at all, which
    // reads as a broken filter rather than as a default doing its job.
    const lines = asShipped({ source: "progress" });
    expect(lines).toHaveLength(3096);
    expect(lines.every((l) => l.source === "progress")).toBe(true);
  });
});

describe("gaps", () => {
  it("ignores lines the generator never voices", () => {
    // Progress text is deliberately never synthesized, so its absence is not a gap.
    const progress = corpus.lines.find((l) => l.source === "progress")!;
    expect(progress.generatable).toBe(false);
    expect(isGap(progress, store)).toBe(false);
  });

  it("missingOnly returns only voiceable lines with no audio", () => {
    const lines = all({ missingOnly: true });
    expect(lines.length).toBeGreaterThan(0);
    // `voiceable`, not the corpus's `generatable`: the latter was baked in before a stage
    // direction could be narrated, so it now says no to lines this app will happily voice.
    expect(lines.every((l) => l.voiceable && !l.hasAudio)).toBe(true);
  });
});

describe("annotation", () => {
  it("gives each line its audio path and presence", () => {
    const line = all({ q: "dughan", filter: "npc" }).find((l) => l.lineId === "q:123:complete")!;
    expect(line.audioPath).toBe("quests/123-complete.mp3");
    expect(line.hasAudio).toBe(store.has(line.audioPath));
  });
});

describe("paging", () => {
  it("reports the whole match set, not the page", () => {
    // Against the whole corpus, so includeProgress: every line counts.
    const page = find({ includeProgress: true });
    expect(page.lines).toHaveLength(50);
    expect(page.total).toBe(corpus.lines.length);
    expect(page.npcCount).toBeGreaterThan(2_000);
  });

  it("does not repeat or skip a line between pages", () => {
    const first = find({ limit: 50, offset: 0 }).lines;
    const second = find({ limit: 50, offset: 50 }).lines;
    const straight = find({ limit: 100, offset: 0 }).lines;

    expect([...first, ...second].map((l) => l.key)).toEqual(straight.map((l) => l.key));
  });

  it("keeps the total stable across pages", () => {
    expect(find({ offset: 0 }).total).toBe(find({ offset: 500 }).total);
  });

  it("ends with a short page rather than an empty one", () => {
    const last = Math.floor((corpus.lines.length - 1) / 50) * 50;
    const page = find({ includeProgress: true, offset: last });
    expect(page.lines.length).toBeGreaterThan(0);
    expect(page.lines.length).toBeLessThanOrEqual(50);
    expect(find({ offset: last + 50 }).lines).toEqual([]);
  });

  it("orders deterministically, or paging would drop lines", () => {
    expect(find({ offset: 300 }).lines.map((l) => l.key)).toEqual(
      find({ offset: 300 }).lines.map((l) => l.key),
    );
  });

  it("keeps an npc's lines together", () => {
    const lines = all({ q: "dughan", filter: "npc" });
    expect(lines.map((l) => l.npcName)).toEqual(Array(lines.length).fill("Marshal Dughan"));
    // Gossip has no quest and sorts after every quest that does.
    const firstGossip = lines.findIndex((l) => l.questId === null);
    expect(lines.slice(firstGossip).every((l) => l.questId === null)).toBe(true);
  });
});

describe("row keys", () => {
  it("are unique across the entire corpus", () => {
    const keys = all();
    expect(keys).toHaveLength(corpus.lines.length);
    expect(new Set(keys.map((l) => l.key)).size).toBe(keys.length);
  });

  it("survive what no field can distinguish", () => {
    // Why the key is positional. Both of these are true of the committed corpus, and either
    // one alone would collide a flat list: gossip lineIds are a hash of the text and are
    // shared by every NPC of that race and gender saying it, and 141 quest lines share an
    // NPC, a quest, a source and an mp3 with another line whose text differs.
    const lineIds = corpus.lines.map((l) => l.lineId);
    expect(new Set(lineIds).size).toBeLessThan(lineIds.length);

    const composite = corpus.lines.map((l) => `${npcKey(l)}/${l.questId}/${l.lineId}`);
    expect(new Set(composite).size).toBeLessThan(composite.length);
  });

  it("keep separate entity types apart", () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    const keys = npcKeys(all({ q: "68", filter: "npc" }));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("batch jobs", () => {
  it("drops lines the generator never voices", () => {
    const jobs = batchJobs(matchingLines(corpus, store, { q: "dughan" }));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.characters > 0)).toBe(true);
  });

  it("generates a shared file once", () => {
    const jobs = batchJobs(corpus.lines);
    expect(new Set(jobs.map((j) => j.audioPath)).size).toBe(jobs.length);
    expect(jobs.length).toBeLessThan(corpus.lines.filter((l) => l.generatable).length);
  });
});

/**
 * Overrides come from Postgres, so search takes them as a context rather than reading them
 * - which is what lets these run against the real corpus and no database.
 */
describe("overrides", () => {
  /** An override is keyed on the audio file, because one mp3 is spoken by many NPCs. */
  const rewrite = (file: string, text: string) => ({
    overrides: new Map([[file, { file, lineId: "", text, updatedAt: "", updatedBy: null }]]),
  });

  it("narrows to audio the current text would no longer produce", () => {
    const file = "quests/123-complete.mp3";
    const context = { ...rewrite(file, "anything"), stale: new Set([file]) };

    const found = matchingLines(corpus, store, { outdated: true }, context);
    expect(found.map((l) => l.lineId)).toEqual(["q:123:complete"]);
  });

  it("matches nothing when staleness was never fetched, rather than everything", () => {
    // The filter costs a query and a hash per take, so it is fetched only when asked for. An
    // absent answer must not read as "every take is out of date".
    expect(matchingLines(corpus, store, { outdated: true })).toEqual([]);
  });

  it("finds a line whose stage direction an override restored", () => {
    // The pipeline stripped 314 directions before synthesis and they were restored as
    // overrides, so the corpus text has no brackets at all. A narration filter reading
    // line.text finds none of them - which is every line most worth finding.
    const file = "quests/123-complete.mp3";
    const context = rewrite(file, "<He turns the crystal over.>\n\nA crystal fragment.");
    const found = matchingLines(corpus, store, { narration: true }, context);

    expect(found.some((l) => l.lineId === "q:123:complete")).toBe(true);
    // And without the override it is not narration, because the corpus text carries none.
    expect(
      matchingLines(corpus, store, { narration: true }).some((l) => l.lineId === "q:123:complete"),
    ).toBe(false);
  });

  it("reports the rewrite beside the corpus text rather than in place of it", () => {
    const context = rewrite("quests/123-complete.mp3", "A crystal fragment.");
    const line = search(corpus, store, { q: "123", filter: "quest", limit: 100 }, context).lines.find(
      (l) => l.lineId === "q:123:complete",
    )!;

    expect(line.override).toBe("A crystal fragment.");
    expect(line.text).not.toBe("A crystal fragment.");
  });

  it("filters to the lines someone has rewritten", () => {
    const context = rewrite("quests/123-complete.mp3", "A crystal fragment.");
    const lines = matchingLines(corpus, store, { overridden: true }, context);
    expect(lines.map((l) => l.lineId)).toEqual(["q:123:complete"]);
  });

  it("makes an invalid-chars line voiceable once the characters are gone", () => {
    // A $ token rather than a stage direction: directions are voiceable on their own now, so
    // only a template token still needs an override to rescue it.
    const broken = corpus.lines.find(
      (l) => l.skipReason === "invalid-chars" && l.text.includes("$"),
    )!;
    const file = `${broken.source === "gossip" ? "gossip" : "quests"}/${broken.fileName}.mp3`;
    const context = rewrite(file, "Thrall grunts.");

    // Nothing was ever generated for it, so "would be voiced and is absent" is now true.
    expect(store.has(file)).toBe(false);
    expect(isGap(broken, store)).toBe(false);
    expect(isGap(broken, store, context.overrides)).toBe(true);

    const jobs = batchJobs([broken], context.overrides);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].characters).toBe("Thrall grunts.".length);
  });

  it("never rescues progress text, which is skipped by policy", () => {
    const progress = corpus.lines.find((l) => l.source === "progress")!;
    const file = `quests/${progress.fileName}.mp3`;
    const context = rewrite(file, "perfectly ordinary text");

    expect(isGap(progress, store, context.overrides)).toBe(false);
    expect(batchJobs([progress], context.overrides)).toHaveLength(0);
  });

  it("prices the text that will be sent, not the text the corpus holds", () => {
    const line = corpus.lines.find((l) => l.lineId === "q:123:complete")!;
    const context = rewrite("quests/123-complete.mp3", "short");
    expect(batchJobs([line], context.overrides)[0].characters).toBe(5);
  });
});

describe("filtering by when the live take was generated", () => {
  const fileOf = (line: { source: string; fileName: string }) =>
    `${line.source === "gossip" ? "gossip" : "quests"}/${line.fileName}.mp3`;

  // Three real corpus lines with dates, and everything else with none.
  const dated = corpus.lines.slice(0, 3);
  const at = (day: string) => new Date(`${day}T12:00:00`).getTime();
  const context = {
    overrides: new Map(),
    generatedAt: new Map([
      [fileOf(dated[0]), at("2026-07-10")],
      [fileOf(dated[1]), at("2026-07-20")],
      [fileOf(dated[2]), at("2026-07-30")],
    ]),
  };

  const withDates = (filters: Parameters<typeof matchingLines>[2]) =>
    matchingLines(corpus, store, filters, context);

  it("keeps only records at or after an 'after' bound", () => {
    const files = new Set(withDates({ generatedAfter: "2026-07-20" }).map(fileOf));
    expect(files.has(fileOf(dated[1]))).toBe(true);
    expect(files.has(fileOf(dated[2]))).toBe(true);
    expect(files.has(fileOf(dated[0]))).toBe(false);
  });

  it("excludes everything with no record from an 'after', however large the corpus", () => {
    // The whole point of the rule: undated audio is old, not recent.
    const lines = withDates({ generatedAfter: "2026-07-01" });
    expect(new Set(lines.map(fileOf))).toEqual(
      new Set(dated.map(fileOf)),
    );
  });

  it("includes everything with no record in a 'before'", () => {
    const lines = withDates({ generatedBefore: "2026-07-15" });
    const files = new Set(lines.map(fileOf));
    expect(files.has(fileOf(dated[0]))).toBe(true);
    expect(files.has(fileOf(dated[2]))).toBe(false);
    // Undated lines vastly outnumber the three dated ones and all survive.
    expect(lines.length).toBeGreaterThan(1000);
  });

  it("includes the whole of the day a bound names", () => {
    // Picking the 30th off a calendar means the 30th, not midnight at its start.
    expect(
      withDates({ generatedBefore: "2026-07-30" }).map(fileOf).includes(fileOf(dated[2])),
    ).toBe(true);
    expect(
      withDates({ generatedAfter: "2026-07-30" }).map(fileOf).includes(fileOf(dated[2])),
    ).toBe(true);
  });

  it("narrows from both ends at once", () => {
    const files = new Set(
      withDates({ generatedAfter: "2026-07-15", generatedBefore: "2026-07-25" }).map(fileOf),
    );
    expect(files).toEqual(new Set([fileOf(dated[1])]));
  });

  it("ignores a bound that is not a date, rather than matching nothing", () => {
    expect(withDates({ generatedAfter: "not-a-date" }).length).toBe(
      matchingLines(corpus, store, {}, context).length,
    );
  });
});

/**
 * Ignored lines: the war-effort tallies and Blizzard's test quest. Passed in as context
 * because the decision lives in Postgres, and these run without one.
 */
describe("ignored lines", () => {
  const ignoring = (lineId: string, reason = "war-effort tally") => ({
    overrides: new Map(),
    ignores: new Map([
      [lineId, { lineId, reason, createdAt: "2026-08-16T00:00:00.000Z", createdBy: null }],
    ]),
  });

  const TALLY = "q:8516:accept";

  it("hides an ignored line from an ordinary search", () => {
    const has = (lines: { lineId: string }[]) => lines.some((l) => l.lineId === TALLY);
    // Quest 8516 has an untouched complete line too, which must stay: this hides one line,
    // not a quest.
    expect(has(matchingLines(corpus, store, { q: "8516", filter: "quest" }, ignoring(TALLY)))).toBe(
      false,
    );
    expect(has(matchingLines(corpus, store, { q: "8516", filter: "quest" }))).toBe(true);
  });

  it("shows only the ignored lines when asked for them", () => {
    const found = matchingLines(corpus, store, { ignored: true }, ignoring(TALLY));
    expect(found.map((l) => l.lineId)).toEqual([TALLY]);
  });

  it("hides them from progress and gap searches too, not just plain ones", () => {
    // The filter runs first on purpose: a line nobody will voice is not an answer to "what
    // is missing?" either, and counting it there is what makes a gap list unactionable.
    const context = ignoring(TALLY);
    const gaps = matchingLines(corpus, store, { missingOnly: true, includeProgress: true }, context);
    expect(gaps.some((l) => l.lineId === TALLY)).toBe(false);
  });

  it("carries the reason onto the row, so the chip can say why", () => {
    const found = search(corpus, store, { ignored: true, limit: 5 }, ignoring(TALLY, "counter"));
    expect(found.lines[0].ignored).toBe("counter");
  });

  it("leaves every other line unignored rather than undefined", () => {
    const found = search(corpus, store, { q: "dughan", filter: "npc", limit: 5 }, ignoring(TALLY));
    expect(found.lines.every((l) => l.ignored === null)).toBe(true);
  });

  it("shows everything when the database could not be reached", () => {
    // NO_CONTEXT has no ignores at all, which must read as "unknown, show them" rather than
    // "nothing is ignored, hide nothing" - the explorer is meant to survive an outage.
    expect(
      matchingLines(corpus, store, { q: "8516", filter: "quest" }).some(
        (l) => l.lineId === TALLY,
      ),
    ).toBe(true);
  });
});

describe("search by line id", () => {
  it("selects exactly the lines carrying that id", () => {
    const sample = all({ q: "dughan", filter: "npc" })[0].lineId;
    const found = all({ line: sample });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((l) => l.lineId === sample)).toBe(true);
  });

  it("keeps every row of a line several NPCs share", () => {
    // A gossip lineId is a hash of the text, so one id can name a dozen speakers, and the
    // explorer has to list all of them rather than the line once.
    const shared = corpus.lines.find(
      (l) => l.source === "gossip" && corpus.lines.filter((o) => o.lineId === l.lineId).length > 1,
    )!;
    const rows = all({ line: shared.lineId });
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((l) => l.lineId))).toEqual(new Set([shared.lineId]));
  });

  it("matches nothing when no line carries the id", () => {
    // What a report about a line the corpus has since dropped resolves to. The whole
    // corpus would be the wrong answer: it reads as "here it is" for something gone.
    expect(all({ line: "q:0:nonexistent" })).toEqual([]);
  });
});

describe("reported lines", () => {
  const reported = (lineId: string, open: number) => ({
    overrides: new Map(),
    reports: new Map([[lineId, open]]),
  });

  it("narrows to lines carrying an open report", () => {
    const found = matchingLines(corpus, store, { reports: "open" }, reported("q:123:complete", 2));
    expect(found.map((l) => l.lineId)).toEqual(["q:123:complete"]);
  });

  it("drops a line whose reports are all resolved", () => {
    expect(matchingLines(corpus, store, { reports: "open" }, reported("q:123:complete", 0))).toEqual([]);
  });

  it("matches nothing when the counts were never fetched, rather than everything", () => {
    expect(matchingLines(corpus, store, { reports: "open" })).toEqual([]);
  });
});
