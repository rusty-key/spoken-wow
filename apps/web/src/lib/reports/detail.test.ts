/**
 * The triage table's view of a line, which has to be one shape across three corpora.
 *
 * Pure and tested here rather than read out inside the expanded row, because the three
 * ResultLine types agree on nothing: quests has `lineId` and `audioPath`, places and readables
 * have `id` and `file`, and a row that read the wrong pair would render an empty panel
 * with no error to see.
 */
import { describe, expect, it } from "vitest";

import { detailOf, regeneratePath, reportTargetOf, searchPath } from "./detail";
import type { ResultLine as BookLine } from "@/lib/readables/search";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { ResultLine as ZoneLine } from "@/lib/places/search";
import type { ResultLine as BossLine } from "@/lib/bosses/search";

const questLine = {
  lineId: "q:374:accept",
  source: "accept",
  questId: 374,
  npcId: 233,
  npcType: "creature",
  npcName: "Marshal Dughan",
  questTitle: "Kobold Camp Cleanup",
  race: "human",
  gender: "male",
  flavor: null,
  voice: "human-male",
  text: "Those kobolds are a menace.",
  audioPath: "quests/374-accept.mp3",
  hasAudio: true,
  stale: false,
} as unknown as QuestLine;

const zoneLine = {
  id: "s:1411:razor hill",
  name: "Razor Hill",
  zoneName: "Durotar",
  text: "A hard-packed road runs north.",
  file: "1411/razor-hill",
  state: "current",
} as unknown as ZoneLine;

const bookLine = {
  id: "b:261",
  pageId: 261,
  key: "261",
  title: "The Dusty Tome",
  pageNumber: 2,
  pageCount: 4,
  text: "It begins with a warning.",
  file: "261/2",
  state: "missing",
} as unknown as BookLine;

describe("detailOf", () => {
  it("names a quest line by its NPC, and says which voice it was cut with", () => {
    const detail = detailOf("quests", questLine);
    expect(detail.heading).toBe("Kobold Camp Cleanup");
    expect(detail.aside).toBe("human male · human-male");
    expect(detail.text).toBe("Those kobolds are a menace.");
    expect(detail.lineId).toBe("q:374:accept");
    expect(detail.audioSrc).toBe("/api/quests/audio/quests/374-accept.mp3");
  });

  it("links the quest and its speaker into the explorer", () => {
    const detail = detailOf("quests", questLine);
    expect(detail.headingHref).toBe("/quests?q=374&filter=quest");
    expect(detail.speaker).toEqual({
      name: "Marshal Dughan",
      page: "/npcs?q=233",
      search: "/quests?q=233&filter=npc&type=creature",
    });
    expect(detail.speakerIsHeading).toBe(false);
    expect(detail.aside).toBe("human male · human-male");
  });

  it("heads a quest-less line with its speaker, and names them once", () => {
    const gossip = { ...questLine, source: "gossip", questId: null, questTitle: null } as QuestLine;
    const detail = detailOf("quests", gossip);
    expect(detail.heading).toBe("Marshal Dughan");
    expect(detail.headingHref).toBeNull();
    expect(detail.speakerIsHeading).toBe(true);
    expect(detail.speaker?.search).toBe("/gossip?q=233&filter=npc&type=creature");
  });

  it("says when the audio was made from text that has since changed", () => {
    expect(detailOf("quests", questLine).stale).toBe(false);
    expect(detailOf("quests", { ...questLine, stale: true } as QuestLine).stale).toBe(true);
    expect(detailOf("places", { ...zoneLine, state: "stale" } as ZoneLine).stale).toBe(true);
    expect(detailOf("readables", bookLine).stale).toBe(false);
  });

  it("carries a quest line's flavor, which is what picks one of that race's voices", () => {
    const shaman = { ...questLine, flavor: "shaman" } as QuestLine;
    expect(detailOf("quests", shaman).aside).toBe("human male shaman · human-male");
  });

  it("places a zone line by zone and subzone", () => {
    const detail = detailOf("places", zoneLine);
    expect(detail.heading).toBe("Razor Hill");
    expect(detail.aside).toBe("Durotar");
    expect(detail.lineId).toBe("s:1411:razor hill");
    expect(detail.audioSrc).toBe("/api/places/audio/1411/razor-hill.mp3");
  });

  it("places a book page in its book", () => {
    const detail = detailOf("readables", bookLine);
    expect(detail.heading).toBe("The Dusty Tome");
    expect(detail.aside).toBe("page 2 of 4");
    expect(detail.lineId).toBe("b:261");
  });

  it("offers no audio for a line that has none, rather than a src that 404s", () => {
    expect(detailOf("readables", bookLine).audioSrc).toBeNull();
    expect(detailOf("quests", { ...questLine, hasAudio: false } as QuestLine).audioSrc).toBeNull();
  });

  it("reads a rewritten quest line as what it now says, not what the corpus says", () => {
    const rewritten = { ...questLine, override: "Those kobolds are a nuisance." } as QuestLine;
    expect(detailOf("quests", rewritten).text).toBe("Those kobolds are a nuisance.");
  });

  it("gives an unwritten boss no text and no audio, even with a take from a withdrawn story", () => {
    const unwritten = {
      id: "boss:36:edwin vancleef",
      name: "Edwin VanCleef",
      instanceName: "Deadmines",
      text: null,
      file: "36/edwin-vancleef",
      state: "stale",
    } as unknown as BossLine;
    const detail = detailOf("bosses", unwritten);
    expect(detail.text).toBeNull();
    expect(detail.audioSrc).toBeNull();
    expect(detailOf("bosses", { ...unwritten, text: "A story.", state: "current" } as BossLine).audioSrc).toBe(
      "/api/bosses/audio/36/edwin-vancleef.mp3",
    );
  });

  it("busts the cache with the take a regeneration just wrote", () => {
    expect(detailOf("places", zoneLine, 7).audioSrc).toBe("/api/places/audio/1411/razor-hill.mp3?v=7");
  });
});

describe("searchPath and regeneratePath", () => {
  it("asks each section's own search for exactly the reported line", () => {
    expect(searchPath("quests", "q:374:accept")).toBe(
      "/api/quests/search?line=q%3A374%3Aaccept&limit=1",
    );
    expect(searchPath("places", "z:1411")).toBe("/api/places/search?line=z%3A1411&limit=1");
  });

  it("posts a regeneration to the section that owns the line", () => {
    expect(regeneratePath("readables")).toBe("/api/readables/regenerate");
    expect(regeneratePath("quests")).toBe("/api/quests/regenerate");
  });
});

/**
 * The address a report travels on, which every row now asks for the same way.
 *
 * Worth pinning per section rather than trusting: each of the three is frozen by
 * AGENTS.md, each /r/ landing page resolves exactly this string, and a report whose
 * address resolves to nothing arrives in triage as a row nobody can act on.
 */
describe("reportTargetOf", () => {
  it("builds a quests address the way the addon does, out of the quest and the event", () => {
    expect(reportTargetOf("quests", questLine)).toBe("quest/374/accept");
  });

  it("addresses a gossip line by its speaker, because gossip has no quest to name", () => {
    const gossip = { ...questLine, source: "gossip", npcId: 233 } as unknown as QuestLine;
    expect(reportTargetOf("quests", gossip)).toBe("npc/233");
  });

  it("refuses a quests line no address can name, rather than inventing one", () => {
    // The row hides its report button in the same case. A "quest/null/accept" would look
    // like a real report and resolve to nothing.
    const orphan = { ...questLine, questId: null } as unknown as QuestLine;
    expect(reportTargetOf("quests", orphan)).toBe(null);
  });

  it("addresses a zone line by its audio path, which is what its report link is", () => {
    expect(reportTargetOf("places", zoneLine)).toBe("1411/razor-hill");
  });

  it("addresses a book page by the page id, which is all the addon has to build a link from", () => {
    expect(reportTargetOf("readables", bookLine)).toBe("261");
  });
});
