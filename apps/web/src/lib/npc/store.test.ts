/**
 * The store, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { getResolution, getResolutionsById, listResolutions, PROVENANCES, upsertResolution } from "./store";

// A bucket no other run shares: these ids are the primary key, so a fixed one would collide
// between concurrent runs against the shared dev database.
let npcId: number;

beforeEach(() => {
  npcId = 900_000_000 + Math.floor(Math.random() * 90_000_000);
});

afterEach(async () => {
  await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
  await db().query(`delete from "entity_name" where "entityId" = $1`, [String(npcId)]);
});

afterAll(async () => {
  await closeDb();
});

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    npcKind: "creature" as const,
    npcId,
    npcName: "Boarton Shadetotem",
    race: "tauren",
    gender: "male",
    flavor: "standard",
    provenance: "client" as const,
    confirmed: false,
    doubtful: false,
    modelFileId: 122055,
    sex: 2,
    creatureType: "Humanoid",
    build: "1.60.1/69913",
    note: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe("upsertResolution", () => {
  it("stores one and reads it back", async () => {
    await upsertResolution(resolution());
    const row = await getResolution("creature", npcId);
    expect(row?.race).toBe("tauren");
    expect(row?.provenance).toBe("client");
    expect(row?.confirmed).toBe(false);
  });

  it("names the npc in the language it was named in, not in English", async () => {
    await upsertResolution({ ...resolution({ npcName: "Eberton Schattentotem" }), nameLang: "deDE" });
    const { rows } = await db().query<{ lang: string; name: string }>(
      `select "lang", "name" from "entity_name" where "kind" = 'creature' and "entityId" = $1`,
      [String(npcId)],
    );
    expect(rows).toEqual([{ lang: "deDE", name: "Eberton Schattentotem" }]);
  });

  it("replaces an earlier answer for the same npc", async () => {
    await upsertResolution(resolution());
    await upsertResolution(
      resolution({ race: "highmountaintauren", provenance: "moderator", confirmed: true }),
    );
    const row = await getResolution("creature", npcId);
    expect(row?.race).toBe("highmountaintauren");
    expect(row?.confirmed).toBe(true);
  });

  // The reason the key is a pair: the same number in the other space is a different thing.
  it("keeps a gameobject with the same id as its own row", async () => {
    await upsertResolution(resolution());
    await upsertResolution(resolution({ npcKind: "gameobject", race: null, npcName: "A Sign" }));
    expect((await getResolution("creature", npcId))?.race).toBe("tauren");
    expect((await getResolution("gameobject", npcId))?.race).toBe(null);
    await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
    await db().query(`delete from "entity_name" where "entityId" = $1`, [String(npcId)]);
  });

  it("answers null for an npc nobody has resolved", async () => {
    expect(await getResolution("creature", npcId)).toBe(null);
  });
});

describe("upsertResolution provenance precedence", () => {
  it("lets a client write over a client row update", async () => {
    await upsertResolution(resolution({ race: "tauren" }));
    const result = await upsertResolution(resolution({ race: "orc" }));
    expect(result.race).toBe("orc");
    expect((await getResolution("creature", npcId))?.race).toBe("orc");
  });

  it("leaves a moderator row untouched by a later client write, and returns the moderator row", async () => {
    await upsertResolution(
      resolution({ race: "highmountaintauren", provenance: "moderator", confirmed: true }),
    );
    const result = await upsertResolution(resolution({ race: "orc", provenance: "client" }));
    expect(result.race).toBe("highmountaintauren");
    expect(result.provenance).toBe("moderator");
    expect(result.confirmed).toBe(true);
    const row = await getResolution("creature", npcId);
    expect(row?.race).toBe("highmountaintauren");
    expect(row?.provenance).toBe("moderator");
  });

  it("lets a moderator write over a moderator row update", async () => {
    await upsertResolution(
      resolution({ race: "highmountaintauren", provenance: "moderator", confirmed: true }),
    );
    const result = await upsertResolution(
      resolution({ race: "tauren", provenance: "moderator", confirmed: true }),
    );
    expect(result.race).toBe("tauren");
    expect((await getResolution("creature", npcId))?.race).toBe("tauren");
  });

  // The concrete failure the rank was built for: an older addon that sends no model at all
  // resolves to "none", and must not wipe out the race a mapped model id already gave us.
  it("does not let a bare 'none' write wipe a client row's race", async () => {
    await upsertResolution(resolution({ race: "tauren", provenance: "client" }));
    const result = await upsertResolution(
      resolution({ race: null, gender: null, flavor: null, provenance: "none" }),
    );
    expect(result.race).toBe("tauren");
    expect(result.provenance).toBe("client");
    const row = await getResolution("creature", npcId);
    expect(row?.race).toBe("tauren");
    expect(row?.provenance).toBe("client");
  });

  // The other shape of the same bug: a model-id guess is not license to overwrite the corpus's
  // exact answer, which carries a flavor nothing else can supply.
  it("does not let a client write overwrite a corpus row", async () => {
    await upsertResolution(
      resolution({ race: "tauren", flavor: "grizzled", provenance: "corpus" }),
    );
    const result = await upsertResolution(
      resolution({ race: "orc", flavor: "standard", provenance: "client" }),
    );
    expect(result.race).toBe("tauren");
    expect(result.flavor).toBe("grizzled");
    expect(result.provenance).toBe("corpus");
    const row = await getResolution("creature", npcId);
    expect(row?.race).toBe("tauren");
    expect(row?.provenance).toBe("corpus");
  });

  it("lets a corpus write over a client row update", async () => {
    await upsertResolution(resolution({ race: "orc", provenance: "client" }));
    const result = await upsertResolution(
      resolution({ race: "tauren", flavor: "grizzled", provenance: "corpus" }),
    );
    expect(result.race).toBe("tauren");
    expect((await getResolution("creature", npcId))?.provenance).toBe("corpus");
  });

  // Equal rank still updates; a name is the extract's to change, so a second one is not written.
  it("lets a corpus write over a corpus row update, keeping the name it first had", async () => {
    await upsertResolution(
      resolution({ npcName: "Boarton Shadetotem", provenance: "corpus", flavor: "elder" }),
    );
    const result = await upsertResolution(
      resolution({ npcName: "Boarton the Elder", provenance: "corpus", flavor: "shaman" }),
    );
    expect(result).toMatchObject({ flavor: "shaman", npcName: "Boarton Shadetotem" });
  });

  // `display` is the game's own voice set for the appearance a player saw: exact, like the
  // corpus, but the corpus is the older authority for the NPCs it carries, so it stays above.
  it("lets a display answer replace a client guess", async () => {
    await upsertResolution(resolution({ flavor: "standard", provenance: "client" }));
    const result = await upsertResolution(
      resolution({ flavor: "warrior", provenance: "display", confirmed: true }),
    );
    expect(result).toMatchObject({ flavor: "warrior", provenance: "display", confirmed: true });
  });

  it("does not let a client guess from an older addon overwrite a display answer", async () => {
    await upsertResolution(resolution({ flavor: "warrior", provenance: "display", confirmed: true }));
    const result = await upsertResolution(resolution({ flavor: "standard", provenance: "client" }));
    expect(result).toMatchObject({ flavor: "warrior", provenance: "display" });
  });

  it("does not let a display answer overwrite the corpus", async () => {
    await upsertResolution(resolution({ flavor: "grim", provenance: "corpus", confirmed: true }));
    const result = await upsertResolution(
      resolution({ flavor: "warrior", provenance: "display", confirmed: true }),
    );
    expect(result).toMatchObject({ flavor: "grim", provenance: "corpus" });
  });
});

// Derived from PROVENANCES rather than listing the values by hand: a fifth provenance added to
// the tuple without a matching branch in provenanceRank falls through to the sentinel below
// `none`, so a write of it can never land here either, and this test names exactly which value
// broke instead of relying on a reviewer to notice a missing `case` line in a different file.
describe("upsertResolution ranks every real provenance above 'none'", () => {
  it.each(PROVENANCES.filter((p) => p !== "none"))("%s beats a 'none' row", async (provenance) => {
    await upsertResolution(
      resolution({ race: null, gender: null, flavor: null, provenance: "none" }),
    );
    const result = await upsertResolution(resolution({ race: "tauren", provenance }));
    expect(result.provenance).toBe(provenance);
    expect(result.race).toBe("tauren");
    expect((await getResolution("creature", npcId))?.provenance).toBe(provenance);
  });
});

describe("getResolutionsById", () => {
  it("returns the one row an id resolves to", async () => {
    await upsertResolution(resolution());
    const grouped = await getResolutionsById([npcId]);
    expect(grouped.get(npcId)?.length).toBe(1);
    expect(grouped.get(npcId)?.[0].race).toBe("tauren");
  });

  it("returns both rows when the id is ambiguous between kinds", async () => {
    await upsertResolution(resolution());
    await upsertResolution(resolution({ npcKind: "gameobject", race: null, npcName: "A Sign" }));
    const grouped = await getResolutionsById([npcId]);
    expect(grouped.get(npcId)?.length).toBe(2);
    expect(grouped.get(npcId)?.map((r) => r.npcKind).sort()).toEqual(["creature", "gameobject"]);
    await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
    await db().query(`delete from "entity_name" where "entityId" = $1`, [String(npcId)]);
  });

  it("answers nothing for an id nobody has resolved", async () => {
    const grouped = await getResolutionsById([npcId]);
    expect(grouped.get(npcId)).toBeUndefined();
  });
});

describe("listResolutions", () => {
  it("lists every kind of an id, whatever its provenance", async () => {
    await upsertResolution(resolution());
    await upsertResolution(resolution({ npcKind: "gameobject", provenance: "moderator", confirmed: true }));
    // An item has a type of its own now, and an admin answers it like any NPC.
    await upsertResolution(resolution({ npcKind: "item", provenance: "moderator", confirmed: true }));
    const ours = (await listResolutions()).filter((row) => row.npcId === npcId);
    expect(ours.map((row) => [row.npcKind, row.provenance])).toEqual([
      ["creature", "client"],
      ["gameobject", "moderator"],
      ["item", "moderator"],
    ]);
  });
});

describe("npc invariants", () => {
  it("rejects a doubtful row that is not a moderator's", async () => {
    await expect(
      upsertResolution(resolution({ provenance: "client", confirmed: false, doubtful: true })),
    ).rejects.toThrow(/npc_doubtful_provenance_check/);
  });

  it("rejects a client row marked confirmed", async () => {
    await expect(
      db().query(
        `insert into "npc"
           ("npcKind", "npcId", "provenance", "confirmed")
         values ($1, $2, 'client', true)`,
        ["creature", npcId],
      ),
    ).rejects.toThrow(/npc_confirmed_provenance_check/);
  });

  it("rejects a 'none' row carrying a race", async () => {
    await expect(
      db().query(
        `insert into "npc"
           ("npcKind", "npcId", "provenance", "race")
         values ($1, $2, 'none', 'tauren')`,
        ["creature", npcId],
      ),
    ).rejects.toThrow(/npc_none_is_empty_check/);
  });
});
