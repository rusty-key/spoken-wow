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
    expect(detemplated(shown("홍길동이여, 홍길동에게 맡기겠소. 홍길동!", { reader: "홍길동" }))).toBe(
      "$N이여, $N에게 맡기겠소. $N!",
    );
    expect(nameless(shown("홍길동입니다. 홍길동에서 홍길동으로.", { reader: "홍길동" })).text).toBe(
      "$N입니다. $N에서 $N으로.",
    );
  });

  it("leaves a Korean name that is only the syllables of a longer word", () => {
    expect(detemplated(shown("어서 오게. 이에 대해서도 레이크샤이어에서 들었네.", { reader: "서" }))).toBe(
      "어서 오게. 이에 대해서도 레이크샤이어에서 들었네.",
    );
    expect(detemplated(shown("우리 기사들을 보게.", { reader: "사" }))).toBe("우리 기사들을 보게.");
    expect(detemplated(shown("대사제께 가 보게, 사제여.", { readerClass: "사제" }))).toBe("대사제께 가 보게, $C여.");
    expect(nameless(shown("어서 오게, 서.", { reader: "서" })).text).toBe("어서 오게, $N.");
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

describe("a reader no game would send", () => {
  it("takes no time over a name of thousands of words, and keeps the name out all the same", () => {
    const words = `${"a ".repeat(16000)}`.trim();
    const envelope = shown("ba".repeat(16000), { reader: words });
    const started = performance.now();
    const kept = nameless(envelope);
    detemplated(envelope);
    expect(performance.now() - started).toBeLessThan(500);
    expect(kept.fields.reader).toBeUndefined();
  });

  it("swaps nothing from a class or race too long to be one", () => {
    const envelope = shown("A warrior, Tester.", { readerClass: `Warrior${" x".repeat(40)}` });
    expect(detemplated(envelope)).toBe("A warrior, $N.");
  });
});

const druid = { readerClass: "德鲁伊", readerRace: "暗夜精灵" };

describe("a Chinese class or race word on a page", () => {
  const page = (text: string, fields: Record<string, string> = {}): Envelope => ({
    source: "readables",
    fields: { page: "1", shown: "1", locale: "zhCN", reader: "小明", ...druid, ...fields },
    text,
  });

  it("is a noun in 资深德鲁伊会避开 (experienced druids partake)", () => {
    const text = "有时候，几位资深德鲁伊会避开永夜港的其他人，偷偷进行暴力的仪式。";
    expect(detemplated(page(text))).toBe(text);
  });

  it("is a possessive noun in 我的德鲁伊之力 (my powers as a druid)", () => {
    const text = "我的德鲁伊之力早已不如从前。";
    expect(detemplated(page(text))).toBe(text);
  });

  it("is an adjective in 德鲁伊咒语 (a druidic incantation)", () => {
    const text = "他低声念起德鲁伊咒语，树枝的光芒随之愈发明亮。";
    expect(detemplated(page(text))).toBe(text);
  });

  it("is the reader when a pause surrounds it: 你好，德鲁伊。", () => {
    expect(detemplated(page("你好，德鲁伊。"))).toBe("你好，$C。");
  });

  // The known cost: a modifier against the address hides it.
  it("is missed behind a glued modifier: 年轻的德鲁伊。", () => {
    expect(detemplated(page("年轻的德鲁伊。"))).toBe("年轻的德鲁伊。");
  });

  it("leaves a name its loose boundary: 做法小明。", () => {
    expect(detemplated(page("做法小明。"))).toBe("做法$N。");
  });

  it("takes the strict boundary on a zhTW page too", () => {
    expect(detemplated(page("他低声念起德魯伊咒語。", { locale: "zhTW", readerClass: "德魯伊" }))).toBe(
      "他低声念起德魯伊咒語。",
    );
  });
});

describe("a Chinese class word on quest text or in gossip", () => {
  const quest = (text: string): Envelope => ({
    source: "quests",
    fields: { quest: "9123", event: "accept", shown: "1", locale: "zhCN", reader: "小明", ...druid },
    text,
  });
  const gossip = (text: string): Envelope => ({
    source: "quests",
    fields: { npc: "12345", shown: "1", locale: "zhCN", reader: "小明", ...druid },
    text,
  });

  it("still swaps behind a modifier on a quest: 尊贵的德鲁伊。", () => {
    expect(detemplated(quest("尊贵的德鲁伊。"))).toBe("尊贵的$C。");
  });

  it("still swaps in gossip, which greets the reader", () => {
    expect(detemplated(gossip("你好，德鲁伊。我给你的建议是：要当心魔法。"))).toBe("你好，$C。我给你的建议是：要当心魔法。");
  });
});
