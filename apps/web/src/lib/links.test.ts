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
  booksHref,
  explorerHref,
  lexiconHref,
  questsHref,
  reportHref,
  targetExplorerHref,
  zonesHref,
} from "./links";

describe("reportHref", () => {
  it("sends a triager to the landing page each section serves", () => {
    expect(reportHref("quests", "quest/84/accept")).toBe("/quests/r/quest/84/accept");
    expect(reportHref("zones", "1411/razor-hill")).toBe("/zones/r/1411/razor-hill");
    // A books target is the bare page id the addon put in the address.
    expect(reportHref("books", "261")).toBe("/books/r/261");
  });

  it("escapes a segment without escaping the separators", () => {
    expect(reportHref("zones", "1411/a b&c")).toBe("/zones/r/1411/a%20b%26c");
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

describe("zonesHref", () => {
  it("names the zone filter the explorer actually reads", () => {
    // filtersFromParams reads `zone`, not `mapID`.
    expect(zonesHref({ mapID: 1411 })).toBe("/zones?zone=1411");
    expect(zonesHref()).toBe("/zones");
  });

  it("scopes a search with `field`, which is what this section reads", () => {
    // NOT `filter`: that is the quests name, and zones would ignore it and search
    // everything - an unnarrowed list that reports no error.
    const href = zonesHref({ q: "Gnomeregan", field: "text" });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("q")).toBe("Gnomeregan");
    expect(params.get("field")).toBe("text");
  });
});

describe("booksHref", () => {
  it("addresses the section, scoped the way books reads it", () => {
    expect(booksHref()).toBe("/books");
    const href = booksHref({ q: "R&D #2", field: "text" });
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
    expect(explorerHref("zones", "z:1411")).toBe("/zones?line=z%3A1411");
    expect(explorerHref("books", "b:261:1")).toBe("/books?line=b%3A261%3A1");
  });

  it("sends a gossip line to the gossip explorer", () => {
    expect(explorerHref("quests", "g:0123abcd")).toBe("/gossip?line=g%3A0123abcd");
  });

  it("names the param each explorer reads, so the link is not a bare section", () => {
    // The three filter vocabularies are three modules; a link that used a name only one
    // of them reads would render the whole corpus and report no error at all.
    for (const source of ["quests", "zones", "books"] as const) {
      const href = explorerHref(source, "x:1");
      expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("line")).toBe("x:1");
    }
  });
});

describe("targetExplorerHref", () => {
  it("narrows quests by the id its address names", () => {
    // The gossip case: a report with no line id, whose address is the whole NPC. A bare
    // number is an id lookup in quests search, so this lands on that creature's lines.
    expect(targetExplorerHref("quests", "npc/10136")).toBe("/gossip?q=10136&filter=npc");
    expect(targetExplorerHref("quests", "quest/84/accept")).toBe("/quests?q=84&filter=quest");
  });

  it("narrows zones by the map its address names", () => {
    expect(targetExplorerHref("zones", "1411/razor-hill")).toBe("/zones?zone=1411");
  });

  it("is null for an address no filter addresses, so the caller keeps the /r/ page", () => {
    // A books target is a bare page id, and neither books field matches ids.
    expect(targetExplorerHref("books", "261")).toBe(null);
    expect(targetExplorerHref("quests", "npc/not-a-number")).toBe(null);
    expect(targetExplorerHref("quests", "npc")).toBe(null);
    expect(targetExplorerHref("zones", "razor-hill")).toBe(null);
  });
});
