import { describe, expect, it } from "vitest";

import { readable, sameLine, wordDiff } from "./compare";

describe("sameLine", () => {
  it("ignores the corpus's $B breaks and spacing", () => {
    expect(sameLine("Hello again, $N.$B$BHave you returned?  ", "Hello again, $N.\n\nHave you returned?")).toBe(true);
  });

  it("matches the name slot whatever case the corpus writes it in", () => {
    expect(sameLine("Trouble with him, $n?", "Trouble with him, $N?")).toBe(true);
  });

  it("lets a slot the addon put in stand for the corpus's own word", () => {
    // A paladin's client turns every "paladin" into $C, the corpus's own word included.
    expect(sameLine("A Forsaken paladin... here?", "A Forsaken $C... here?")).toBe(true);
    expect(sameLine("Tauren hunt out of necessity.", "$R hunt out of necessity.")).toBe(true);
    expect(sameLine("For the Night Elf people.", "For the $R people.")).toBe(true);
  });

  it("lets a corpus slot stand for a name the client failed to put back", () => {
    expect(sameLine("¿Has rescatado mis libros, $N?", "¿Has rescatado mis libros, Index?")).toBe(true);
  });

  it("takes one side of every $G, as one player's client does", () => {
    const template = "Hello, $gsir:madam;! You are $Gthe one:the one; I want. $Gbrave:bold;!";
    expect(sameLine(template, "Hello, sir! You are the one I want. brave!")).toBe(true);
    expect(sameLine(template, "Hello, madam! You are the one I want. bold!")).toBe(true);
    expect(sameLine(template, "Hello, sir! You are the one I want. bold!")).toBe(false);
  });

  it("takes a side of $u as of $G", () => {
    expect(sameLine("Seid gegrüßt, $uReisender:Reisende;.", "Seid gegrüßt, Reisende.")).toBe(true);
  });

  it("matches a client that left $G unexpanded", () => {
    expect(sameLine("Go, $gUm caçador:Uma caçadora;.", "Go, $gUm caçador:Uma caçadora;.")).toBe(true);
  });

  it("ignores letter case", () => {
    expect(sameLine("Bring the tumor endurecido.", "Bring the Tumor Endurecido.")).toBe(true);
  });

  it("tells a changed word apart", () => {
    expect(sameLine("Turn right. It is safer.", "Turn left. It is safer.")).toBe(false);
    expect(sameLine("I'm busy settling in and learning.", "I'm busy learning.")).toBe(false);
  });

  it("counts punctuation", () => {
    expect(sameLine("The Argent Dawn - and the rest.", "The Argent Dawn: and the rest.")).toBe(false);
  });

  it("does not let a slot swallow punctuation", () => {
    expect(sameLine("Hello, $N!", "Hello, friend, you!")).toBe(false);
  });

  it("lets frFR's $cs stand for the class plural the client printed", () => {
    expect(sameLine("Les $cs de la Main d'argent.", "Les paladins de la Main d'argent.")).toBe(true);
    expect(sameLine("Les $cs de la Main d'argent.", "Les démonistes de la Main d'argent.")).toBe(true);
  });

  it("still asks for the s of $cs", () => {
    expect(sameLine("Les $cs sont là.", "Les paladin sont là.")).toBe(false);
    expect(sameLine("Les $cs sont là.", "Les s sont là.")).toBe(false);
    // A paladin's client puts back "paladin", without the s, as $C.
    expect(sameLine("Les $cs sont là.", "Les $C sont là.")).toBe(false);
  });

  it("leaves a plain $c as it was", () => {
    expect(sameLine("Salut, $c.", "Salut, paladin.")).toBe(true);
  });
});

describe("readable", () => {
  it("turns $B into line breaks", () => {
    expect(readable("One.$B$BTwo.")).toBe("One.\n\nTwo.");
  });
});

describe("wordDiff", () => {
  it("marks the words each side lacks, one run per phrase", () => {
    const diff = wordDiff("I'm busy settling in and learning about elementals.", "I'm busy learning about elementals.");
    expect(diff.before).toEqual([
      { text: "I'm busy ", changed: false },
      { text: "settling in and", changed: true },
      { text: " learning about elementals.", changed: false },
    ]);
    expect(diff.after).toEqual([{ text: "I'm busy learning about elementals.", changed: false }]);
  });

  it("does not mark a change of case", () => {
    expect(wordDiff("Hello, $n.", "Hello, $N.").after).toEqual([{ text: "Hello, $N.", changed: false }]);
  });

  it("marks a swapped word on both sides and keeps each side's spacing", () => {
    const diff = wordDiff("Turn right.\n\nGo.", "Turn left.  Go.");
    expect(diff.before).toEqual([
      { text: "Turn ", changed: false },
      { text: "right.", changed: true },
      { text: "\n\nGo.", changed: false },
    ]);
    expect(diff.after).toEqual([
      { text: "Turn ", changed: false },
      { text: "left.", changed: true },
      { text: "  Go.", changed: false },
    ]);
  });
});
