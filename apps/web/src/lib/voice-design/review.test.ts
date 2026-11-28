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
    ).toEqual({ status: "needs-work", note: "sounds female", bestPreview: 2, clips: { "sample:1": "off", "preview:0": "good" }, players: [], observations: [], userId: "u1" });
  });

  it("keeps the players' notes picked for the next version, as they read now", () => {
    const review = parseReview({ status: "needs-work", players: [{ showingId: 7, voter: "u:y" }] }, design, "u1");
    expect(review.players).toEqual([{ verdict: "close", note: "slower" }]);
  });

  it("drops a pick whose note was hidden since, and keeps the verdict", () => {
    const review = parseReview({ status: "needs-work", players: [{ showingId: 7, voter: "a:nobody" }, { showingId: 7, voter: "a:x" }] }, design, "u1");
    expect(review.players).toEqual([{ verdict: "off", note: "too soft" }]);
  });

  it("keeps What's different's findings apart from the reviewer's own note", () => {
    const review = parseReview(
      {
        status: "needs-work",
        note: "faster, more assertive",
        observations: [
          { by: "gemini", note: " slower pace and breathier texture with lower energy " },
          { by: "claude", note: "higher and thinner than the live take", fixes: ["Remove 'airy'.", "", 3] },
        ],
      },
      design,
      "u1",
    );
    expect(review.note).toBe("faster, more assertive");
    expect(review.observations).toEqual([
      { by: "gemini", note: "slower pace and breathier texture with lower energy" },
      { by: "claude", note: "higher and thinner than the live take", fixes: ["Remove 'airy'."] },
    ]);
  });

  it("cuts an over-long observation rather than losing the verdict", () => {
    const review = parseReview({ status: "good", observations: [{ by: "claude", note: "x".repeat(600) }] }, design, "u1");
    expect(review.observations?.[0].note).toHaveLength(500);
  });

  it.each([
    [{ status: "good", observations: [{ by: "gpt", note: "x" }] }, /gemini or claude/],
    [{ status: "good", observations: [{ by: "gemini", note: " " }] }, /observation/],
    [{ status: "good", observations: [{ by: "gemini" }] }, /observation/],
    [{ status: "good", observations: "slower" }, /observations/],
    [{ status: "great" }, /verdict/],
    [{ status: "good", bestPreview: 5 }, /preview/],
    [{ status: "good", clips: { "sample:2": "off" } }, /sample:2/],
    [{ status: "good", clips: { "sample:0": "meh" } }, /sample:0/],
    [{ status: "good", note: "x".repeat(2001) }, /2000/],
  ])("refuses %j", (body, error) => {
    expect(() => parseReview(body, design, "u1")).toThrow(error);
  });
});
