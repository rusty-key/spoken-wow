import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODES } from "@/lib/lang";
import type { Viewer } from "@/lib/permissions";

const who = vi.hoisted(() => ({
  signedIn: true,
  role: "member" as string,
  grants: [] as { lang: string; capability: string }[],
}));

vi.mock("@/lib/session", () => ({
  currentSession: async () =>
    who.signedIn ? { user: { id: "u1", email: "a@example.invalid", role: who.role } } : null,
}));
vi.mock("@/lib/grants/store", () => ({
  viewerOf: async (session: { user: { role: string } } | null): Promise<Viewer | null> =>
    session ? ({ role: session.user.role, grants: who.grants } as Viewer) : null,
}));

import { GET } from "./route";

beforeEach(() => {
  who.signedIn = true;
  who.role = "member";
  who.grants = [];
});

describe("manager contributor route", () => {
  it("signed out answers 401", async () => {
    who.signedIn = false;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "signed out" });
  });

  it("a member with no grants answers 200 with adminLangs []", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: "a@example.invalid", adminLangs: [] });
  });

  it("a language admin answers only that language", async () => {
    who.grants = [
      { lang: "frFR", capability: "admin" },
      { lang: "deDE", capability: "edit" },
    ];
    expect((await (await GET()).json()).adminLangs).toEqual(["frFR"]);
  });

  it("a global admin answers every code in CODES", async () => {
    who.role = "admin";
    expect((await (await GET()).json()).adminLangs).toEqual([...CODES]);
  });
});
