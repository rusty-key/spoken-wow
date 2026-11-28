import { describe, expect, it } from "vitest";

import { wowheadEntityUrl, wowheadQuestUrl } from "./wowhead";

describe("wowhead links", () => {
  it("points at the Forever database, not retail or Classic", () => {
    // The retail page for a vanilla quest may describe a quest that was changed or removed.
    expect(wowheadQuestUrl("enUS", 8516)).toBe("https://www.wowhead.com/forever/quest=8516");
    // A post-vanilla NPC has no page on /classic/.
    expect(wowheadEntityUrl("enUS", "creature", 205729)).toBe("https://www.wowhead.com/forever/npc=205729");
  });

  it("spells each id space the way Wowhead does", () => {
    expect(wowheadEntityUrl("enUS", "creature", 240)).toBe("https://www.wowhead.com/forever/npc=240");
    expect(wowheadEntityUrl("enUS", "gameobject", 68)).toBe("https://www.wowhead.com/forever/object=68");
    expect(wowheadEntityUrl("enUS", "item", 1307)).toBe("https://www.wowhead.com/forever/item=1307");
  });

  it("keeps the two id spaces apart", () => {
    // Creature 68 is a Stormwind City Guard; gameobject 68 is a Wanted Poster.
    expect(wowheadEntityUrl("enUS", "creature", 68)).not.toBe(wowheadEntityUrl("enUS", "gameobject", 68));
  });

  it("opens the page's own language edition", () => {
    expect(wowheadQuestUrl("koKR", 97968)).toBe("https://www.wowhead.com/forever/ko/quest=97968");
    expect(wowheadEntityUrl("deDE", "creature", 240)).toBe("https://www.wowhead.com/forever/de/npc=240");
    expect(wowheadQuestUrl("zhCN", 8516)).toBe("https://www.wowhead.com/forever/cn/quest=8516");
    expect(wowheadQuestUrl("zhTW", 8516)).toBe("https://www.wowhead.com/forever/tw/quest=8516");
  });

  it("keeps the two Spanish editions apart", () => {
    // Quest 95775 is "La Ciudad Sumergida" on /es/ and "La Ciudad Anegada" on /mx/.
    expect(wowheadQuestUrl("esES", 95775)).toBe("https://www.wowhead.com/forever/es/quest=95775");
    expect(wowheadQuestUrl("esMX", 95775)).toBe("https://www.wowhead.com/forever/mx/quest=95775");
  });

  it("falls back to English for a language Wowhead has no edition of", () => {
    expect(wowheadQuestUrl("jaJP", 8516)).toBe("https://www.wowhead.com/forever/quest=8516");
  });
});
