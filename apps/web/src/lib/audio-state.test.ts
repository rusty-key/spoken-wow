import { describe, expect, it } from "vitest";

import { audioStateFromParams } from "./audio-state";

const read = (query: string) => audioStateFromParams(new URLSearchParams(query));

describe("audioStateFromParams", () => {
  it("reads the state places and readables links carry", () => {
    expect(read("state=missing")).toBe("missing");
    expect(read("state=stale")).toBe("stale");
    expect(read("state=current")).toBe("current");
  });

  it("still opens a quests link made with the old checkboxes", () => {
    expect(read("missing=1")).toBe("missing");
    expect(read("outdated=1")).toBe("stale");
  });

  it("prefers state over an old key the same URL still carries", () => {
    expect(read("state=current&missing=1")).toBe("current");
  });

  it("drops a value it does not know rather than matching nothing", () => {
    expect(read("state=bogus")).toBeUndefined();
    expect(read("")).toBeUndefined();
  });
});
