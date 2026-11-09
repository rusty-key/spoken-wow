import { describe, expect, it } from "vitest";

import { wowheadEntityUrl, wowheadQuestUrl } from "./wowhead";

describe("wowhead links", () => {
  it("points at the Forever database, not retail or Classic", () => {
    // The retail page for a vanilla quest may describe a quest that was changed or removed.
    expect(wowheadQuestUrl(8516)).toBe("https://www.wowhead.com/forever/quest=8516");
    // A post-vanilla NPC has no page on /classic/.
    expect(wowheadEntityUrl("creature", 205729)).toBe("https://www.wowhead.com/forever/npc=205729");
  });

  it("spells each id space the way Wowhead does", () => {
    expect(wowheadEntityUrl("creature", 240)).toBe("https://www.wowhead.com/forever/npc=240");
    expect(wowheadEntityUrl("gameobject", 68)).toBe("https://www.wowhead.com/forever/object=68");
    expect(wowheadEntityUrl("item", 1307)).toBe("https://www.wowhead.com/forever/item=1307");
  });

  it("keeps the two id spaces apart", () => {
    // Creature 68 is a Stormwind City Guard; gameobject 68 is a Wanted Poster.
    expect(wowheadEntityUrl("creature", 68)).not.toBe(wowheadEntityUrl("gameobject", 68));
  });
});
