import { describe, expect, it } from "vitest";

import { parseReview } from "./review";

const design = { previews: [{}, {}, {}], samples: [{}, {}] } as never;

describe("parseReview", () => {
  it("keeps a verdict with its note, best preview and clip marks", () => {
    expect(
      parseReview({ status: "needs-work", note: " sounds female ", bestPreview: 2, clips: { "sample:1": "off", "preview:0": "good" } }, design, "u1"),
    ).toEqual({ status: "needs-work", note: "sounds female", bestPreview: 2, clips: { "sample:1": "off", "preview:0": "good" }, userId: "u1" });
  });

  it.each([
    [{ status: "great" }, /verdict/],
    [{ status: "good", bestPreview: 5 }, /preview/],
    [{ status: "good", clips: { "sample:2": "off" } }, /sample:2/],
    [{ status: "good", clips: { "sample:0": "meh" } }, /sample:0/],
    [{ status: "good", note: "x".repeat(2001) }, /2000/],
  ])("refuses %j", (body, error) => {
    expect(() => parseReview(body, design, "u1")).toThrow(error);
  });
});
