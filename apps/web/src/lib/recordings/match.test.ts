import { describe, expect, it } from "vitest";

import { matchUploads, parseUploadName, recordingStem } from "./match";

describe("recordingStem", () => {
  it("flattens each section's file to the name an actor saves it under", () => {
    expect(recordingStem("quests", "quests/33-accept.mp3")).toBe("33-accept");
    expect(recordingStem("quests", "quests/m-33-accept.mp3")).toBe("m-33-accept");
    expect(recordingStem("quests", "gossip/31abcdef.mp3")).toBe("31abcdef");
    expect(recordingStem("places", "1411/razor-hill")).toBe("1411-razor-hill");
    expect(recordingStem("places", "947/zone")).toBe("947-zone");
    expect(recordingStem("readables", "1381")).toBe("1381");
  });
});

describe("parseUploadName", () => {
  it("reads the format from the extension, case and folders aside", () => {
    expect(parseUploadName("Session 3/1411-Razor-Hill.MP3")).toEqual({ stem: "1411-razor-hill", format: "mp3" });
    expect(parseUploadName("C:\\takes\\33-accept.ogg")).toEqual({ stem: "33-accept", format: "ogg" });
    expect(parseUploadName("33-accept.wav").format).toBeNull();
    expect(parseUploadName("33-accept").format).toBeNull();
  });
});

describe("matchUploads", () => {
  const places = ["1411/razor-hill", "1411/zone", "947/zone"];

  it("pairs each name with its file", () => {
    expect(matchUploads("places", ["1411-razor-hill.ogg", "947-zone.mp3"], places)).toEqual([
      { name: "1411-razor-hill.ogg", file: "1411/razor-hill", format: "ogg" },
      { name: "947-zone.mp3", file: "947/zone", format: "mp3" },
    ]);
  });

  it("says why a name lands nowhere", () => {
    expect(matchUploads("places", ["zone.mp3", "1411-razor-hill.wav"], places)).toEqual([
      { name: "zone.mp3", file: null, reason: "unmatched" },
      { name: "1411-razor-hill.wav", file: null, reason: "format" },
    ]);
  });

  it("refuses to guess between two files one name could be", () => {
    const files = ["quests/4377-dwarf.mp3", "followup/4377-dwarf.mp3"];
    expect(matchUploads("quests", ["4377-dwarf.mp3"], files)).toEqual([
      { name: "4377-dwarf.mp3", file: null, reason: "ambiguous" },
    ]);
  });

  it("refuses both of two takes of one file, since which ships is the actor's call", () => {
    expect(matchUploads("readables", ["1381.mp3", "1381.ogg", "1382.mp3"], ["1381", "1382"])).toEqual([
      { name: "1381.mp3", file: null, reason: "duplicate" },
      { name: "1381.ogg", file: null, reason: "duplicate" },
      { name: "1382.mp3", file: "1382", format: "mp3" },
    ]);
  });
});
