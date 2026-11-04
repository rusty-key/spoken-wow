import { describe, expect, it } from "vitest";

import { bumped } from "./ReleaseReview";

describe("bumped", () => {
  it("bumps each part and resets the ones after it", () => {
    expect(bumped("1.9.3", "patch")).toBe("1.9.4");
    expect(bumped("1.9.3", "minor")).toBe("1.10.0");
    expect(bumped("1.9.3", "major")).toBe("2.0.0");
  });

  it("has nothing to count from without a three-part version", () => {
    expect(bumped(null, "patch")).toBeNull();
    expect(bumped(undefined, "patch")).toBeNull();
    expect(bumped("1.2", "patch")).toBeNull();
    expect(bumped("1.x.0", "patch")).toBeNull();
  });
});
