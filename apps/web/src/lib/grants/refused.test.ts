import { beforeEach, describe, expect, it, vi } from "vitest";

import { textByTeam } from "@/lib/languages/store";

import { refusedGrant } from "./store";

vi.mock("@/lib/languages/store", async (original) => ({
  ...(await original<typeof import("@/lib/languages/store")>()),
  textByTeam: vi.fn(async () => false),
}));

const langAdmin = { role: null, grants: [{ lang: "deDE", capability: "admin" as const }] };

describe("refusedGrant", () => {
  beforeEach(() => vi.mocked(textByTeam).mockClear());

  it("reads whose text it is only when text is asked for", async () => {
    expect(await refusedGrant(langAdmin, ["regenerate", "admin"], "deDE")).toBeNull();
    expect(textByTeam).not.toHaveBeenCalled();

    expect(await refusedGrant(langAdmin, ["regenerate", "text"], "deDE")).toBe("text");
    expect(textByTeam).toHaveBeenCalledWith("deDE");
  });
});
