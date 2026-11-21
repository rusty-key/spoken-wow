import { describe, expect, it } from "vitest";

import {
  BODY_MAX,
  isCategory,
  isStatus,
  optionalText,
  queuesOf,
  queueView,
  SOURCE_LABELS,
  validateSubmission,
} from "./reports";
import { SOURCES, isSource } from "@/lib/sections";

describe("isSource", () => {
  it("accepts every section that can file a report", () => {
    // The gate on the public write path: a source it rejects becomes "quests" there, so a
    // readables report would be filed against the wrong corpus rather than refused. Migration
    // 0028 widened the table's check constraint to match this list.
    expect(isSource("quests")).toBe(true);
    expect(isSource("places")).toBe(true);
    expect(isSource("readables")).toBe(true);
    expect(isSource("lexicon")).toBe(false);
  });

  it("names every one of them for the triage table", () => {
    for (const source of SOURCES) {
      expect(SOURCE_LABELS[source]).toBeTruthy();
    }
  });
});

describe("isCategory", () => {
  it("accepts a known category", () => {
    expect(isCategory("pronunciation")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCategory("lore")).toBe(false);
    expect(isCategory(null)).toBe(false);
  });
});

describe("isStatus", () => {
  it("accepts the three statuses and nothing else", () => {
    expect(isStatus("open")).toBe(true);
    expect(isStatus("not_an_issue")).toBe(true);
    expect(isStatus("resolved")).toBe(false);
  });
});

describe("optionalText", () => {
  it("truncates rather than rejecting", () => {
    expect(optionalText("a".repeat(300), 200)).toHaveLength(200);
  });

  it("returns null for blank and non-string input", () => {
    expect(optionalText("   ", 200)).toBeNull();
    expect(optionalText(undefined, 200)).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("accepts a minimal report", () => {
    expect(validateSubmission({ category: "missing", body: "No audio at all." })).toEqual({
      ok: true,
      value: { category: "missing", body: "No audio at all.", name: null, email: null },
    });
  });

  it("trims the body and rejects one that is empty after trimming", () => {
    expect(validateSubmission({ category: "other", body: "   " })).toEqual({
      ok: false,
      error: "body is required",
    });
  });

  it("rejects a body over the limit rather than truncating it", () => {
    expect(validateSubmission({ category: "other", body: "x".repeat(BODY_MAX + 1) }).ok).toBe(
      false,
    );
  });

  it("rejects an unknown category", () => {
    expect(validateSubmission({ category: "lore", body: "hi" })).toEqual({
      ok: false,
      error: "unknown category",
    });
  });
});

describe("queuesOf", () => {
  const member = (capability: "text" | "edit" | "admin" | "regenerate") => ({
    role: "member",
    grants: [{ lang: "deDE", capability }],
  });

  it("gives each capability its queue, in its language only", () => {
    expect(queuesOf(member("text"), "deDE")).toEqual(["text"]);
    expect(queuesOf(member("edit"), "deDE")).toEqual(["audio"]);
    expect(queuesOf(member("admin"), "deDE")).toEqual(["audio"]);
    expect(queuesOf(member("regenerate"), "deDE")).toEqual([]);
    expect(queuesOf(member("text"), "frFR")).toEqual([]);
    expect(queuesOf(null, "deDE")).toEqual([]);
  });

  it("gives a site owner both", () => {
    expect(queuesOf({ role: "admin", grants: [] }, "deDE")).toEqual(["text", "audio"]);
  });
});

describe("queueView", () => {
  const same = { text: new Set(["a"]), audio: new Set(["a"]) };
  const differ = { text: new Set(["a"]), audio: new Set(["b"]) };

  it("shows nothing to somebody holding both, or while the groups are the same people", () => {
    expect(queueView(["text", "audio"], same)).toEqual({ labelled: false, passTo: [] });
  });

  it("labels one queue when somebody else works the other, and passes between them", () => {
    expect(queueView(["text"], differ)).toEqual({ labelled: true, passTo: ["text", "audio"] });
  });

  it("offers a pass to a holder of both when the groups differ, without labels", () => {
    expect(queueView(["text", "audio"], differ)).toEqual({ labelled: false, passTo: ["text", "audio"] });
  });

  it("never offers the queue nobody works, nor labels against it", () => {
    expect(queueView(["audio"], { text: new Set(), audio: new Set(["b"]) })).toEqual({
      labelled: false,
      passTo: ["audio"],
    });
  });
});
