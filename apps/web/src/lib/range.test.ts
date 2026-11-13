import { describe, expect, it } from "vitest";

import { isSafeAudioPath, parseRange } from "./range";

describe("path safety", () => {
  it("accepts store-relative mp3 paths", () => {
    expect(isSafeAudioPath("quests/123-complete.mp3")).toBe(true);
    expect(isSafeAudioPath("gossip/m-abc123.mp3")).toBe(true);
    expect(isSafeAudioPath("followup/f-4377-dwarf-male-standard.mp3")).toBe(true);
  });

  it("rejects traversal and anything outside the two subfolders", () => {
    // audio/ lives outside the web root; this route must not become a file-read primitive.
    for (const bad of [
      "../../etc/passwd",
      "quests/../../etc/passwd",
      "/etc/passwd",
      "quests/sub/dir.mp3",
      "corpus/corpus.json.gz",
      "quests/notes.txt",
    ]) {
      expect(isSafeAudioPath(bad), bad).toBe(false);
    }
  });
});

describe("range parsing", () => {
  it("returns null when there is no range", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-10", 1000)).toBeNull();
  });

  it("parses a bounded range", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=200-299", 1000)).toEqual({ start: 200, end: 299 });
  });

  it("parses Safari's opening probe", () => {
    expect(parseRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
  });

  it("treats an open end as the rest of the file", () => {
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("clamps an end past the file to the last byte", () => {
    expect(parseRange("bytes=0-9999", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("parses a suffix range", () => {
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("reports a start past the end of the file as unsatisfiable", () => {
    expect(parseRange("bytes=2000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
