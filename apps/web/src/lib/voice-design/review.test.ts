import { describe, expect, it } from "vitest";

import { parseReview } from "./review";

const design = {
  previews: [{}, {}, {}],
  samples: [{}, {}],
  showings: [{ id: 7, notes: [{ voter: "a:x", verdict: "off", note: "too soft" }, { voter: "u:y", verdict: "close", note: "slower" }] }],
} as never;

describe("parseReview", () => {
  it("keeps a verdict with its note, best preview and clip marks", () => {
    expect(
      parseReview({ status: "needs-work", note: " sounds female ", bestPreview: 2, clips: { "sample:1": "off", "preview:0": "good" } }, design, "u1"),
    ).toEqual({ status: "needs-work", note: "sounds female", bestPreview: 2, clips: { "sample:1": "off", "preview:0": "good" }, players: [], userId: "u1" });
  });

  it("keeps the players' notes picked for the next version, as they read now", () => {
    const review = parseReview({ status: "needs-work", players: [{ showingId: 7, voter: "u:y" }] }, design, "u1");
    expect(review.players).toEqual([{ verdict: "close", note: "slower" }]);
  });

  it("drops a pick whose note was hidden since, and keeps the verdict", () => {
    const review = parseReview({ status: "needs-work", players: [{ showingId: 7, voter: "a:nobody" }, { showingId: 7, voter: "a:x" }] }, design, "u1");
    expect(review.players).toEqual([{ verdict: "off", note: "too soft" }]);
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
