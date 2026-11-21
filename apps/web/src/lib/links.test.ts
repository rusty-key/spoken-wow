/**
 * The addresses one page uses to reach another.
 *
 * Worth a test of its own because the failure mode is silent: the quests explorer used to
 * be the site root, so /issues and /lexicon pointed at `/?q=…`, and after the merge that
 * address is the landing page. It renders, it returns 200, and it shows none of what the
 * link meant. Nothing in a build, a typecheck or a route test can see that; only an
 * assertion about the string can.
 */
import { describe, expect, it } from "vitest";

import {
  readablesHref,
  explorerHref,
  lexiconHref,
  npcHref,
  npcPageHref,
  questsHref,
  reportHref,
  targetExplorerHref,
  placesHref,
} from "./links";

describe("reportHref", () => {
  it("sends a triager to the landing page each section serves", () => {
    expect(reportHref("quests", "quest/84/accept")).toBe("/quests/r/quest/84/accept");
    expect(reportHref("places", "1411/razor-hill")).toBe("/places/r/1411/razor-hill");
    // A readables target is the bare page id the addon put in the address.
    expect(reportHref("readables", "261")).toBe("/readables/r/261");
    expect(reportHref("bosses", "36/edwin-vancleef")).toBe("/bosses/r/36/edwin-vancleef");
  });

  it("escapes a segment without escaping the separators", () => {
    expect(reportHref("places", "1411/a b&c")).toBe("/places/r/1411/a%20b%26c");
  });
});

describe("questsHref", () => {
  it("addresses the section, never the site root", () => {
    expect(questsHref({})).toBe("/quests");
    expect(questsHref({ q: "thrall" }).startsWith("/quests?")).toBe(true);
  });

  it("carries a finding as the filter, with the word for the search box", () => {
    const href = questsHref({ finding: 42, q: "--", filter: "text" });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("finding")).toBe("42");
    expect(params.get("q")).toBe("--");
    expect(params.get("filter")).toBe("text");
  });

  it("escapes a word the URL would otherwise read as syntax", () => {
    // Findings are corpus text: '&', '#' and '+' all appear in it, and an unescaped one
    // either truncates the query or arrives as a different word.
    const href = questsHref({ q: "R&D #2 + more", filter: "text" });
    expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("q")).toBe("R&D #2 + more");
  });

  it("omits what was not asked for", () => {
    expect(questsHref({ finding: 7 })).toBe("/quests?finding=7");
  });
});

describe("npcHref", () => {
  it("narrows the quests explorer to one NPC of one kind", () => {
    expect(npcHref({ npcId: 233, npcType: "creature", gossip: false })).toBe(
      "/quests?q=233&filter=npc&type=creature",
    );
  });

  it("sends a gossip speaker to the gossip explorer", () => {
    expect(npcHref({ npcId: 68, npcType: "gameobject", gossip: true })).toBe(
      "/gossip?q=68&filter=npc&type=gameobject",
    );
  });
});

describe("npcPageHref", () => {
  it("opens the NPCs page on one NPC", () => {
    expect(npcPageHref(233)).toBe("/npcs?q=233");
  });
});

describe("placesHref", () => {
  it("names the zone filter the explorer actually reads", () => {
    // filtersFromParams reads `zone`, not `mapID`.
    expect(placesHref({ mapID: 1411 })).toBe("/places?zone=1411");
    expect(placesHref()).toBe("/places");
  });

  it("scopes a search with `field`, which is what this section reads", () => {
    // NOT `filter`: that is the quests name, and places would ignore it and search
    // everything - an unnarrowed list that reports no error.
    const href = placesHref({ q: "Gnomeregan", field: "text" });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("q")).toBe("Gnomeregan");
    expect(params.get("field")).toBe("text");
  });
});

describe("readablesHref", () => {
  it("addresses the section, scoped the way readables reads it", () => {
    expect(readablesHref()).toBe("/readables");
    const href = readablesHref({ q: "R&D #2", field: "text" });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("q")).toBe("R&D #2");
    expect(params.get("field")).toBe("text");
  });
});

describe("lexiconHref", () => {
  it("fills the grapheme in", () => {
    expect(lexiconHref("Anduin")).toBe("/lexicon?grapheme=Anduin");
  });
});

describe("explorerHref", () => {
  it("narrows each section's explorer to one line", () => {
    expect(explorerHref("quests", "q:374:accept")).toBe("/quests?line=q%3A374%3Aaccept");
    expect(explorerHref("places", "z:1411")).toBe("/places?line=z%3A1411");
    expect(explorerHref("readables", "b:261:1")).toBe("/readables?line=b%3A261%3A1");
  });

  it("names the param each explorer reads, so the link is not a bare section", () => {
    // The three filter vocabularies are three modules; a link that used a name only one
    // of them reads would render the whole corpus and report no error at all.
    for (const source of ["quests", "places", "readables", "bosses"] as const) {
      const href = explorerHref(source, "x:1");
      expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("line")).toBe("x:1");
    }
  });
});

describe("targetExplorerHref", () => {
  it("narrows quests by the id its address names", () => {
    // The gossip case: a report with no line id, whose address is the whole NPC. A bare
    // number is an id lookup in quests search, so this lands on that creature's lines.
    expect(targetExplorerHref("quests", "npc/10136")).toBe("/quests?q=10136&filter=npc");
    expect(targetExplorerHref("quests", "quest/84/accept")).toBe("/quests?q=84&filter=quest");
  });

  it("narrows places by the map its address names", () => {
    expect(targetExplorerHref("places", "1411/razor-hill")).toBe("/places?zone=1411");
  });

  it("narrows bosses by the instance its address names", () => {
    expect(targetExplorerHref("bosses", "36/edwin-vancleef")).toBe("/bosses?instance=36");
  });

  it("is null for an address no filter addresses, so the caller keeps the /r/ page", () => {
    // A readables target is a bare page id, and neither readables field matches ids.
    expect(targetExplorerHref("readables", "261")).toBe(null);
    expect(targetExplorerHref("quests", "npc/not-a-number")).toBe(null);
    expect(targetExplorerHref("quests", "npc")).toBe(null);
    expect(targetExplorerHref("places", "razor-hill")).toBe(null);
    expect(targetExplorerHref("bosses", "edwin-vancleef")).toBe(null);
  });
});
