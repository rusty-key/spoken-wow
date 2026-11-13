import { describe, expect, it } from "vitest";

import * as npcs from "@/app/api/npcs/route";

import * as triage from "./route";

describe("POST /api/contributions/npc", () => {
  it("is the admin-only /api/npcs write", () => {
    expect(triage.POST).toBe(npcs.POST);
  });
});
