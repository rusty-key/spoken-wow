// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { Facets } from "@/lib/facets";
import type { SearchResult } from "@/lib/search";
import type { ViewedTeam } from "@/lib/teams/viewing";

import Explorer from "./Explorer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/deDE/quests",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/components/useCan", () => ({
  useCan: () => (capability: string) => ["regenerate", "text", "ignore"].includes(capability),
}));

const facets: Facets = { races: [], genders: [], flavors: [], voices: [], flavorScopes: [] };
const result: SearchResult = { lines: [], total: 12, npcCount: 3, offset: 0, limit: 50 };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/quests/search")
      ? new Response(JSON.stringify(result), { status: 200 })
      : new Response("{}", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

const teams = [
  { id: "t-main", slug: "main-crew", name: "Main Crew", privileged: true },
  { id: "t-second", slug: "second-crew", name: "Second Crew", privileged: false },
];

function explorer(viewed: ViewedTeam | null) {
  render(
    <LangProvider lang="deDE">
      <Explorer facets={facets} teams={viewed ? teams : []} viewed={viewed} home="second-crew" />
    </LangProvider>,
  );
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

test("another team's view asks for its lines, and offers no batch or queue", async () => {
  explorer({ team: "t-main", slug: "main-crew", name: "Main Crew", own: false });
  await screen.findByText("12 lines across 3 NPCs");

  expect(urls().filter((url) => url.startsWith("/api/quests/search"))).not.toHaveLength(0);
  for (const url of urls()) expect(new URL(url, "http://x").searchParams.get("team")).toBe("main-crew");
  expect(screen.queryByRole("button", { name: /Regenerate all/ })).toBeNull();
  expect(urls().some((url) => url.includes("/api/regenerate/queue"))).toBe(false);
});

test("the visitor's own view offers the batch and sends no team", async () => {
  explorer(null);
  await screen.findByText("12 lines across 3 NPCs");

  for (const url of urls()) expect(url).not.toContain("team=");
  expect(screen.getByRole("button", { name: /Regenerate all 12/ })).not.toBeNull();
  await waitFor(() => expect(urls().some((url) => url.includes("/api/regenerate/queue"))).toBe(true));
});
