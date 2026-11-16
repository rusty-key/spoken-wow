import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { addonVersion, contextFacts, contextFrom, folderVersion, isOlder, lineNews, outdatedPack, packVersion } from "./context";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");

describe("contextFrom", () => {
  it("reads the addon's envelope into fields and text", () => {
    const context = contextFrom(fixture("quests-observed.txt"), "quests");
    expect(context?.fields.quest).toBe("76156");
    expect(context?.text).toBe("We'll need to work on your stealth skills, druid.");
  });

  it("drops another section's envelope, a broken one and anything not a string", () => {
    expect(contextFrom(fixture("quests-observed.txt"), "readables")).toBeNull();
    expect(contextFrom(fixture("quests-observed.txt").replace("druid", "rogue"), "quests")).toBeNull();
    expect(contextFrom({ fields: {} }, "quests")).toBeNull();
  });
});

describe("addonVersion", () => {
  it("is the release after the addon's name, and nothing for a checkout", () => {
    expect(addonVersion({ fields: { addon: "SpokenQuests/3.4.0" }, text: null })).toBe("3.4.0");
    expect(addonVersion({ fields: { addon: "SpokenBooks/3.0.0-beta.2" }, text: null })).toBe("3.0.0-beta.2");
    expect(addonVersion({ fields: { addon: "SpokenZones/dev" }, text: null })).toBeNull();
  });
});

describe("outdatedPack", () => {
  const heard = (pack: string, packVersion?: string) => ({
    fields: { pack, ...(packVersion ? { packVersion } : {}) },
    text: null,
  });

  it("names the newer release of the pack language the player was hearing", () => {
    expect(outdatedPack(heard("deDE", "1.2.0"), { deDE: "1.10.0", enUS: "1.0.0" })).toEqual({
      version: "1.2.0",
      latest: "1.10.0",
    });
  });

  it("is nothing for a current pack, no pack, an older addon or a language never released", () => {
    expect(outdatedPack(heard("deDE", "1.10.0"), { deDE: "1.10.0" })).toBeNull();
    expect(outdatedPack(heard("deDE", "none"), { deDE: "1.10.0" })).toBeNull();
    expect(outdatedPack(heard("deDE"), { deDE: "1.10.0" })).toBeNull();
    expect(outdatedPack(heard("frFR", "1.0.0"), { deDE: "1.10.0" })).toBeNull();
    // A folder the newest release left alone is behind it and still current: triage weighs the language's newest.
    expect(outdatedPack({ fields: { pack: "deDE", packVersion: "1.10.0", packFolderVersion: "1.2.0" }, text: null }, { deDE: "1.10.0" })).toBeNull();
  });
});

describe("the pack versions", () => {
  const sent = (fields: Record<string, string>) => ({ fields, text: null });

  it("keeps the language's newest apart from the line's folder", () => {
    const both = sent({ packVersion: "1.3.0", packFolderVersion: "1.1.0" });
    expect(packVersion(both)).toBe("1.3.0");
    expect(folderVersion(both)).toBe("1.1.0");
    expect(folderVersion(sent({ packVersion: "1.3.0", packFolderVersion: "none" }))).toBeNull();
  });
});

describe("lineNews", () => {
  const releases = [
    { version: "1.3.0", at: "2026-11-10T00:00:00Z" },
    { version: "1.2.0", at: "2026-11-05T00:00:00Z" },
    { version: "1.1.0", at: "2026-11-01T00:00:00Z" },
  ];
  const heard = (packVersion?: string) => ({ fields: { pack: "enUS", ...(packVersion ? { packVersion } : {}) }, text: null });

  it("finds a take recorded after the player's pack in the release that followed it", () => {
    expect(lineNews(heard("1.1.0"), releases, "2026-11-03T00:00:00Z")).toEqual({
      version: "1.1.0",
      exact: false,
      latest: "1.3.0",
      recordedAt: "2026-11-03T00:00:00Z",
      shipsIn: "1.2.0",
      inYours: false,
    });
  });

  it("knows a take in the player's pack, and one in no release yet", () => {
    expect(lineNews(heard("1.2.0"), releases, "2026-11-03T00:00:00Z")).toMatchObject({ shipsIn: "1.2.0", inYours: true });
    expect(lineNews(heard("1.3.0"), releases, "2026-11-12T00:00:00Z")).toMatchObject({
      latest: null,
      shipsIn: null,
      inYours: false,
    });
  });

  it("with the line's folder named, weighs that folder's version and names the release carrying the take", () => {
    const folder = (packFolderVersion: string) => ({
      fields: { pack: "enUS", packVersion: "1.3.0", packFolder: "SpokenQuestsAudioHorde", packFolderVersion },
      text: null,
    });
    expect(lineNews(folder("1.1.0"), releases, "2026-11-03T00:00:00Z")).toMatchObject({
      version: "1.1.0",
      exact: true,
      latest: "1.2.0",
      inYours: false,
    });
    // 1.3.0 left the Horde folder alone: its 1.2.0 is the newest it has.
    expect(lineNews(folder("1.2.0"), releases, "2026-11-03T00:00:00Z")).toMatchObject({ latest: null, inYours: true });
  });

  it("cannot place a take older than every release in a pack older than all of them", () => {
    expect(lineNews(heard("1.0.0"), releases, "2026-10-01T00:00:00Z")).toMatchObject({ shipsIn: "1.1.0", inYours: null });
    expect(lineNews(heard("1.1.0"), releases, "2026-10-01T00:00:00Z")).toMatchObject({ inYours: true });
  });

  it("says nothing of the pack without a version or releases, and nothing at all without a take", () => {
    expect(lineNews(heard(), releases, "2026-11-03T00:00:00Z")).toMatchObject({ version: null, inYours: null });
    expect(lineNews(heard("1.1.0"), undefined, "2026-11-03T00:00:00Z")).toMatchObject({ latest: null, shipsIn: null, inYours: null });
    expect(lineNews(heard("1.1.0"), releases, null)).toBeNull();
  });
});

describe("isOlder", () => {
  it("compares by number, not by text", () => {
    expect(isOlder("3.4.0", "3.10.0")).toBe(true);
    expect(isOlder("3.10.0", "3.4.0")).toBe(false);
    expect(isOlder("3.4.0", "3.4.0")).toBe(false);
  });

  it("puts a beta before its release", () => {
    expect(isOlder("3.0.0-beta.3", "3.0.0")).toBe(true);
    expect(isOlder("3.0.0-beta.2", "3.0.0-beta.10")).toBe(true);
    expect(isOlder("3.0.0", "3.0.0-beta.3")).toBe(false);
  });
});

describe("contextFacts", () => {
  it("names the addon, the client, the NPC and the quest", () => {
    const context = contextFrom(fixture("quests-observed.txt"), "quests")!;
    expect(contextFacts(context)).toEqual([
      { label: "Addon", value: "SpokenQuests 2.0.4" },
      { label: "Client", value: "1.60.1/69913" },
      { label: "Language", value: "enUS" },
      { label: "NPC", value: "9123 Boarton Shadetotem" },
      { label: "Quest", value: "76156 progress Stalk With The Earthmother" },
      { label: "Seen", value: "creature, Humanoid, male" },
    ]);
  });
});
