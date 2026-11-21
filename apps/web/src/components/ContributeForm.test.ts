import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checksum } from "@/lib/contributions/envelope";

import { previewOf } from "./ContributeForm";

// There is no component-test setup in this repo (no @testing-library/*, and
// vitest.config.ts only collects src/**/*.test.ts, not .tsx) — so this exercises previewOf
// as the plain function it is, the same way BookList.test.ts exercises bookRuns.
const envelope = readFileSync(
  new URL("../../../../tests/fixtures/contributions/quests-accept.txt", import.meta.url),
  "utf8",
);

/**
 * An envelope that parses cleanly but that checkEnvelope should still refuse -- there is no
 * Lua fixture for these because the writer never produces them; they are the shapes a
 * hand-edited paste box can still reach (parseEnvelope only checks the wire format).
 */
function build(source: string, fields: Record<string, string>, text?: string): string {
  const lines = [`!SPOKEN1 ${source}`, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)];
  if (text) lines.push("text<<", text, ">>");
  const body = lines.join("\n") + "\n";
  return body + `sum=${checksum(body)}\n`;
}

describe("previewOf", () => {
  it("shows what will be sent, field by field", () => {
    const preview = previewOf(envelope);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.rows).toContainEqual({ label: "Quest", value: "9123" });
    expect(preview.text).toContain("Убей шестерых.");
  });

  it("says which source the paste is, which decides what the form asks for", () => {
    const preview = previewOf(build("places", { map: "1537", locale: "enUS" }));
    expect(preview).toMatchObject({ ok: true, source: "places" });
  });

  it("explains a bad paste in the reader's terms, not the parser's", () => {
    const preview = previewOf(envelope.slice(0, 80));
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.message).toMatch(/copied|whole/i);
  });

  it("says nothing at all about an empty box", () => {
    expect(previewOf("")).toEqual({ ok: false, message: "" });
  });

  // Before this fix, previewOf ran only parseEnvelope, so each of these parsed cleanly,
  // enabled Send, and then failed at submissionFrom with a generic "did not go through".
  describe("refuses what submissionFrom would, before Send is ever enabled", () => {
    it("a page id that isn't a number", () => {
      const preview = previewOf(build("readables", { page: "abc", locale: "enUS" }, "Words."));
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.message).toMatch(/page id/i);
    });

    it("a places envelope carrying text, which the addon never sends", () => {
      const preview = previewOf(
        build("places", { map: "1537", subzone: "A Nook", locale: "enUS" }, "not from the addon"),
      );
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.message).toMatch(/from the addon never/i);
    });

    it("a quests envelope with no text, which is the whole payload", () => {
      const preview = previewOf(build("quests", { quest: "1", event: "accept", locale: "enUS" }));
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.message).toMatch(/text/i);
    });
  });
});
