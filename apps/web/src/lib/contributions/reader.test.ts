import { describe, expect, it } from "vitest";

import type { Envelope } from "./envelope";
import { detemplated, nameless } from "./reader";

const shown = (text: string, fields: Record<string, string> = {}): Envelope => ({
  source: "quests",
  fields: { quest: "9123", event: "accept", shown: "1", reader: "Tester", ...fields },
  text,
});

describe("detemplated", () => {
  it("puts the name, class and race back as tokens, whole words only", () => {
    const envelope = shown("Tester! A Night Elf warrior, Tester's kind. Testers and Tester2 stay.", {
      readerClass: "Warrior",
      readerRace: "Night Elf",
    });
    expect(detemplated(envelope)).toBe("$N! A $R $c, $N's kind. Testers and Tester2 stay.");
  });

  it("swaps the class in either gender's form", () => {
    const envelope = shown("Eine Kriegerin, Tester.", { readerClass: "Krieger", readerClassFemale: "Kriegerin" });
    expect(detemplated(envelope)).toBe("Eine $C, $N.");
  });

  it("keeps a class-only quest's class phrase from a part of the name", () => {
    const fields = { reader: "Valaas Hunter", readerClass: "Demon Hunter", readerClassID: "12", questClasses: "2048" };
    const envelope = shown("Demon Hunter, rise. Valaas, Hunter.", fields);
    expect(detemplated(envelope)).toBe("Demon Hunter, rise. $N, $N.");
    expect(nameless(envelope).text).toBe("Demon Hunter, rise. $N, $N.");
  });

  it("leaves the class as written on a quest only that class can take", () => {
    const fields = { readerClass: "Paladin", readerClassID: "2" };
    const text = "Tester, a paladin must reflect the Light.";
    expect(detemplated(shown(text, { ...fields, questClasses: "2" }))).toBe("$N, a paladin must reflect the Light.");
    expect(detemplated(shown(text, { ...fields, questClasses: "6" }))).toBe("$N, a $c must reflect the Light.");
    expect(detemplated(shown(text, fields))).toBe("$N, a $c must reflect the Light.");
  });

  it("swaps a surnamed character whole, by either part, and in capitals", () => {
    const reader = { reader: "Valaas Dawnsight" };
    expect(detemplated(shown("Greetings, young Valaas. The Dawnsight name is known, Valaas Dawnsight.", reader))).toBe(
      "Greetings, young $N. The $N name is known, $N.",
    );
    expect(detemplated(shown("VALAAS DAWNSIGHT! Valaas. VALAASWOOD stays.", reader))).toBe("$N! $N. VALAASWOOD stays.");
  });

  it("does not let a part of the name take a longer class phrase first", () => {
    const envelope = shown("Demon Hunter, rise. Valaas, Hunter.", { reader: "Valaas Hunter", readerClass: "Demon Hunter" });
    expect(detemplated(envelope)).toBe("$C, rise. $N, $N.");
  });

  it("reads an accented or Cyrillic name in capitals as the name", () => {
    expect(detemplated(shown("ZÖPF, Zöpf, Zöpfe.", { reader: "Zöpf" }))).toBe("$N, $N, Zöpfe.");
    expect(detemplated(shown("ГРИМБАЛОР.", { reader: "Гримбалор" }))).toBe("$N.");
  });

  it("swaps a lowercase Cyrillic class, which the addon's own string.lower could not make", () => {
    expect(detemplated(shown("Ты храбрый воин, Tester.", { readerClass: "Воин" }))).toBe("Ты храбрый $c, $N.");
  });

  it("ends a name at a particle written straight after it", () => {
    expect(detemplated(shown("홍길동님, 어서 오세요.", { reader: "홍길동" }))).toBe("$N님, 어서 오세요.");
  });

  it("reads an envelope from an older addon as the template it already is", () => {
    const old: Envelope = { source: "quests", fields: { quest: "9123", event: "accept" }, text: "Tester, $N." };
    expect(detemplated(old)).toBe("Tester, $N.");
  });
});

describe("nameless", () => {
  it("takes the name out of the text and the fields, and leaves class and race as shown", () => {
    const envelope = shown("Demon Hunter Tester, a Night Elf.", {
      reader: "Valaas Hunter",
      readerClass: "Demon Hunter",
      readerRace: "Night Elf",
    });
    const kept = nameless({ ...envelope, text: "Demon Hunter Valaas, a Night Elf. Hunter." });
    expect(kept.text).toBe("Demon Hunter $N, a Night Elf. $N.");
    expect(kept.fields.reader).toBeUndefined();
    expect(kept.fields).toMatchObject({ shown: "1", readerClass: "Demon Hunter", readerRace: "Night Elf" });
  });

  it("takes the name out of an envelope that carries one without the mark", () => {
    const unmarked: Envelope = { source: "quests", fields: { quest: "9123", event: "accept", reader: "Tester" }, text: "Hail, Tester." };
    const kept = nameless(unmarked);
    expect(kept.fields.reader).toBeUndefined();
    expect(kept.text).toBe("Hail, $N.");
  });

  it("detemplates to the same text before and after", () => {
    const envelope = shown("Tester the warrior.", { readerClass: "Warrior" });
    expect(detemplated(nameless(envelope))).toBe(detemplated(envelope));
  });
});
