import { describe, expect, it } from "vitest";

import { clientFilterOf, clientOf, matchesClient } from "./client";

describe("clientOf", () => {
  it.each([
    ["1.15.7/61582", "era", "Classic Era 1.15.7"],
    ["1.60.1/69913", "forever", "Forever 1.60.1"],
    ["2.5.5/64796", "anniversary", "TBC Anniversary 2.5.5"],
    ["12.0.5/66102", "retail", "Retail 12.0.5"],
    ["1.12.1/5875", "legacy", "Legacy client 1.12.1"],
    ["2.4.3/8606", "legacy", "Legacy client 2.4.3"],
    ["3.3.5/12340", "legacy", "Legacy client 3.3.5"],
    ["5.5.1/63000", "other", "Other 5.5.1"],
  ])("classifies %s as %s", (build, family, label) => {
    const client = clientOf(build);
    expect(client.family).toBe(family);
    expect(client.label).toBe(label);
  });

  it("keeps the two halves of the build apart", () => {
    expect(clientOf("1.60.1/69913")).toMatchObject({ version: "1.60.1", buildNumber: "69913" });
  });

  // GetBuildInfo missing on the client is written as "?/?" by every addon's envelope, and an
  // envelope from before `build` was a required field stores "".
  it.each(["?/?", "", null, undefined])("says unknown for %s rather than guessing", (build) => {
    expect(clientOf(build)).toMatchObject({ family: "other", label: "Unknown client", version: null });
  });
});

describe("client filters", () => {
  it.each([undefined, "", "forever-ish", ["era"]])("falls back to Era and Forever for %s", (value) => {
    expect(clientFilterOf(value)).toBe("focus");
  });

  it.each(["focus", "low-effort", "era", "retail", "all"])("reads %s as itself", (value) => {
    expect(clientFilterOf(value)).toBe(value);
  });

  it("puts Era and Forever in focus and every other family in low effort", () => {
    for (const family of ["era", "forever"] as const) {
      expect(matchesClient(family, "focus")).toBe(true);
      expect(matchesClient(family, "low-effort")).toBe(false);
    }
    for (const family of ["anniversary", "retail", "legacy", "other"] as const) {
      expect(matchesClient(family, "focus")).toBe(false);
      expect(matchesClient(family, "low-effort")).toBe(true);
    }
  });

  // An NPC only the extract names was sent by no client, and must not vanish from the default view.
  it("keeps a row no client sent in focus and all only", () => {
    expect(matchesClient(null, "focus")).toBe(true);
    expect(matchesClient(null, "all")).toBe(true);
    expect(matchesClient(null, "low-effort")).toBe(false);
    expect(matchesClient(null, "era")).toBe(false);
  });

  it("narrows to one family", () => {
    expect(matchesClient("retail", "retail")).toBe(true);
    expect(matchesClient("era", "retail")).toBe(false);
  });
});
