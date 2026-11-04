import { describe, expect, it } from "vitest";

import { parseLog, segments } from "./log";

const join = (line: { segments: { text: string }[] }) => line.segments.map((s) => s.text).join("");

describe("parseLog", () => {
  it("reads step headers, the outcome and errors", () => {
    const lines = parseLog(
      "==> step 4/5: upload\nSpokenQuestsAudioHorde_deDE: hashing\nerror: the bucket said no\n==> released 1.1.0: SpokenQuestsAudioHorde_deDE\n",
    );
    expect(lines.map((line) => line.kind)).toEqual(["step", "plain", "error", "final"]);
    expect(lines[0].step).toEqual({ at: 4, of: 5, name: "upload" });
    expect(join(lines[0])).toBe("Step 4 of 5 · upload");
    expect(join(lines[3])).toBe("released 1.1.0: SpokenQuestsAudioHorde_deDE");
  });

  it("shows a byte count in MB", () => {
    expect(join(parseLog("415 new blobs, 44410828 bytes")[0])).toBe("415 new blobs, 44.4 MB");
  });

  it("reads an empty log as no lines", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("segments", () => {
  it("colours a pack's changes and keeps the line whole", () => {
    const line = "SpokenQuestsAudioGossip_deDE: +312 ~12 -0";
    const parts = segments(line);
    expect(parts.map((p) => p.text).join("")).toBe(line);
    expect(parts.filter((p) => p.tone !== "plain")).toEqual([
      { text: "SpokenQuestsAudioGossip_deDE", tone: "pack" },
      { text: "+312", tone: "add" },
      { text: "~12", tone: "change" },
      { text: "-0", tone: "remove" },
    ]);
  });

  it("leaves a timestamp and a byte count alone", () => {
    const line = "index.json now at 20261104T075308Z for 44410828 bytes";
    expect(segments(line)).toEqual([{ text: line, tone: "plain" }]);
  });
});
