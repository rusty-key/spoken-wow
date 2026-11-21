/**
 * What an API save records for undo, and retiring a first translation so the line reads as
 * untranslated again. Run for each section, because each has its own table and catalogue.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogue as bossCatalogue } from "@/lib/bosses/catalogue";
import { retireStory, saveStory, StoryConflict } from "@/lib/bosses/story";
import { closeDb } from "@/lib/db";
import { nameHistory, NameConflict, retireName, saveName } from "@/lib/names/store";
import { catalogue as placeCatalogue } from "@/lib/places/catalogue";
import { LoreConflict, retireLore, saveLore } from "@/lib/places/lore";
import { corpus } from "@/lib/quests/catalogue";
import { keepLanguage } from "@/lib/quests/keep-language";
import { QuestTextConflict, retireQuestText, saveQuestText } from "@/lib/quests/text";
import { catalogue as bookCatalogue } from "@/lib/readables/catalogue";
import { BookConflict, retireBookText, saveBookText } from "@/lib/readables/text";
import { asSystem } from "@/lib/teams/testing";

import { createFixtures, LANG, type Fixtures } from "./testing";

let f: Fixtures;
const AUDIT = { tokenId: "token-1", batchId: "batch-1" };

beforeAll(async () => {
  f = await createFixtures();
});

keepLanguage(LANG);

afterAll(async () => {
  await f.remove();
  await closeDb();
});

async function lastDetail(subject: string, kind = "text.edited") {
  const { rows } = await asSystem.query<{ detail: Record<string, unknown> }>(
    `select "detail" from "activity" where "actorId" = $1 and "subject" = $2 and "kind" = $3
      order by "id" desc limit 1`,
    [f.user, subject, kind],
  );
  return rows[0]?.detail;
}

type Saved = { version: number };

const sections: {
  name: string;
  id: () => string;
  save(text: string, audit?: typeof AUDIT): Promise<Saved>;
  retire(version: number): Promise<void>;
  conflict: new (message: string) => Error;
  reads: () => Promise<{ untranslated: boolean; text: string | null }>;
}[] = [
  {
    name: "places",
    id: () => f.zone,
    save: (text, audit) => saveLore({ lang: LANG, lineId: f.zone, full: text, editedBy: f.user, audit }),
    retire: (version) => retireLore(f.zone, version, LANG, f.user),
    conflict: LoreConflict,
    reads: async () => {
      const entry = (await placeCatalogue(LANG)).find((e) => e.id === f.zone)!;
      return { untranslated: entry.missing?.text === true, text: entry.full };
    },
  },
  {
    name: "bosses",
    id: () => f.boss.lineId,
    save: (text, audit) => saveStory({ lang: LANG, lineId: f.boss.lineId, text, editedBy: f.user, audit }),
    retire: (version) => retireStory(f.boss.lineId, version, LANG, f.user),
    conflict: StoryConflict,
    reads: async () => {
      const entry = (await bossCatalogue(LANG)).find((e) => e.id === f.boss.lineId)!;
      return { untranslated: entry.text === null, text: entry.text };
    },
  },
  {
    name: "readables",
    id: () => f.page.lineId,
    save: (text, audit) => saveBookText({ lang: LANG, lineId: f.page.lineId, text, editedBy: f.user, audit }),
    retire: (version) => retireBookText(f.page.lineId, version, LANG, f.user),
    conflict: BookConflict,
    reads: async () => {
      const entry = (await bookCatalogue(LANG)).find((e) => e.id === f.page.lineId)!;
      return { untranslated: entry.missing?.text === true, text: entry.text };
    },
  },
  {
    name: "quests",
    id: () => f.quest.lineId,
    save: (text, audit) =>
      saveQuestText({ lang: LANG, lineId: f.quest.lineId, variant: f.quest.variant, text, editedBy: f.user, audit }),
    retire: (version) => retireQuestText(f.quest.lineId, f.quest.variant, LANG, version, f.user),
    conflict: QuestTextConflict,
    reads: async () => {
      const line = (await corpus(LANG)).lines.find((l) => l.lineId === f.quest.lineId)!;
      return { untranslated: line.skipReason === "untranslated", text: line.text };
    },
  },
];

describe.each(sections)("$name", (section) => {
  it("records previous, apiTokenId and apiBatchId when audit is given", async () => {
    await section.save("First words.", AUDIT);
    expect(await lastDetail(section.id())).toMatchObject({
      version: 1,
      previous: null,
      apiTokenId: "token-1",
      apiBatchId: "batch-1",
    });

    await section.save("Second words.", AUDIT);
    expect(await lastDetail(section.id())).toMatchObject({ version: 2, previous: 1 });
  });

  it("records none of them on a save with no audit", async () => {
    await section.save("Plain words.");
    const detail = await lastDetail(section.id());
    expect(detail).not.toHaveProperty("previous");
    expect(detail).not.toHaveProperty("apiTokenId");
    expect(detail).not.toHaveProperty("apiBatchId");
  });

  it("retires the row, leaving no current row but keeping the row itself", async () => {
    const { version } = await section.save("Words to retire.");
    expect((await section.reads()).text).toBe("Words to retire.");

    await section.retire(version);

    const after = await section.reads();
    expect(after.untranslated).toBe(true);
    expect(after.text).not.toBe("Words to retire.");
    expect(await lastDetail(section.id(), "text.retired")).toMatchObject({ version });
  });

  it("writes a new version after retiring, not over the old one", async () => {
    const { version } = await section.save("Retired first.");
    await section.retire(version);
    expect((await section.save("Translated again.")).version).toBe(version + 1);
  });

  it("refuses to retire a version that is not current", async () => {
    const { version } = await section.save("Older words.");
    await section.save("Newer words.");
    await expect(section.retire(version)).rejects.toThrow(section.conflict);
  });
});

describe("names", () => {
  const BOSS = () => String(f.boss.id);

  it("records previous and audit on a name", async () => {
    await saveName({ kind: "boss", entityId: BOSS(), lang: LANG, name: "First name", editedBy: f.user, audit: AUDIT });
    expect(await lastDetail(`boss:${BOSS()}`, "name.edited")).toMatchObject({
      version: 1,
      previous: null,
      apiBatchId: "batch-1",
    });
  });

  it("retireName leaves the catalogue falling back to the English name", async () => {
    const saved = await saveName({ kind: "boss", entityId: BOSS(), lang: LANG, name: "Retired name", editedBy: f.user });
    const named = async () => (await bossCatalogue(LANG)).find((e) => e.id === f.boss.lineId)!;
    expect((await named()).name).toBe("Retired name");

    await retireName("boss", BOSS(), LANG, saved.version, f.user);

    expect(await named()).toMatchObject({ name: "Test Boss", nameMissing: true });
    expect((await nameHistory("boss", BOSS(), LANG)).some((v) => v.isCurrent)).toBe(false);
    expect(await lastDetail(`boss:${BOSS()}`, "name.retired")).toMatchObject({ version: saved.version });
  });

  it("retireName refuses a version that is not current", async () => {
    const older = await saveName({ kind: "boss", entityId: BOSS(), lang: LANG, name: "Older", editedBy: f.user });
    await saveName({ kind: "boss", entityId: BOSS(), lang: LANG, name: "Newer", editedBy: f.user });
    await expect(retireName("boss", BOSS(), LANG, older.version, f.user)).rejects.toThrow(NameConflict);
  });
});
