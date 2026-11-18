// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { Facets } from "@/lib/facets";
import type { ResultLine, SearchResult } from "@/lib/search";
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
const line: ResultLine = {
  lineId: "q:1:accept",
  source: "accept",
  questId: 1,
  questTitle: "A Quest",
  npcId: 2,
  npcName: "Grunt",
  npcType: "creature",
  race: "orc",
  gender: "male",
  flavor: null,
  voice: "orc-male-standard",
  playerGender: null,
  text: "Lok'tar.",
  originalText: "Lok'tar.",
  fileName: "1-accept",
  generatable: true,
  skipReason: null,
  key: "q:1:accept|0",
  hasAudio: true,
  audioPath: "quests/1-accept.mp3",
  reportsOpen: 0,
  take: { version: 1, takes: 1 },
  stale: false,
  dirty: false,
  override: "Lok'tar ogar.",
  driftedOverride: null,
  voiceable: true,
  narration: false,
  narrationRestored: false,
  ignored: null,
  madeBy: null,
};
const result: SearchResult = { lines: [line], total: 12, npcCount: 3, offset: 0, limit: 50 };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/quests/search")
      ? new Response(JSON.stringify(result), { status: 200 })
      : new Response("{}", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = () => {};
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
const named = (name: RegExp) => screen.queryAllByRole("button", { name });
const audioSrc = () => document.querySelector("audio")?.getAttribute("src") ?? null;

async function playGrunt() {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Play Grunt's line" }));
  await waitFor(() => expect(audioSrc()).not.toBeNull());
}

test("another team's view asks for its lines, and offers no batch or queue", async () => {
  explorer({ team: "t-main", slug: "main-crew", name: "Main Crew", own: false });
  await screen.findByText("12 lines across 3 NPCs");

  expect(urls().filter((url) => url.startsWith("/api/quests/search"))).not.toHaveLength(0);
  for (const url of urls()) expect(new URL(url, "http://x").searchParams.get("team")).toBe("main-crew");
  expect(screen.queryByRole("button", { name: /Regenerate all/ })).toBeNull();
  expect(urls().some((url) => url.includes("/api/regenerate/queue"))).toBe(false);
  expect(screen.getByText("Lok'tar ogar.")).not.toBeNull();
  expect(named(/^Edit the spoken text/)).toHaveLength(0);
  expect(named(/^Report /)).toHaveLength(0);
  expect(named(/^Ignore/)).toHaveLength(0);

  await playGrunt();
  expect(new URL(audioSrc()!, "http://x").searchParams.get("team")).toBe("main-crew");
});

test("the visitor's own view offers the batch and sends no team", async () => {
  explorer(null);
  await screen.findByText("12 lines across 3 NPCs");

  for (const url of urls()) expect(url).not.toContain("team=");
  expect(screen.getByRole("button", { name: /Regenerate all 12/ })).not.toBeNull();
  await waitFor(() => expect(urls().some((url) => url.includes("/api/regenerate/queue"))).toBe(true));
  expect(named(/^Edit the spoken text/)).toHaveLength(1);
  // Report and Ignore sit behind the row's More menu once the row has edit actions.
  await userEvent.setup().click(named(/^More actions/)[0]);
  expect(named(/^Report /)).toHaveLength(1);
  expect(named(/^Ignore/)).toHaveLength(1);

  await playGrunt();
  expect(audioSrc()).not.toContain("team=");
});

test("a team the search no longer knows leaves no rows, rather than breaking the page", async () => {
  fetchMock.mockImplementation(async () => Response.json({ error: "no team main-crew voices deDE" }, { status: 404 }));
  explorer({ team: "t-main", slug: "main-crew", name: "Main Crew", own: false });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText("Team")).not.toBeNull());
  expect(screen.queryByText(/lines across/)).toBeNull();
});
