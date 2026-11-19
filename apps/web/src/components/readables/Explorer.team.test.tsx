// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { ResultLine, SearchResult } from "@/lib/readables/search";
import type { ViewedTeam } from "@/lib/teams/viewing";

import { Explorer } from "./Explorer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/deDE/readables",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/components/useCan", () => ({
  useCan: () => (capability: string) => capability === "regenerate" || capability === "text",
}));

const page: ResultLine = {
  id: "b:12",
  pageId: 12,
  key: "12",
  bookId: "12",
  pageNumber: 1,
  pageCount: 1,
  title: "Ein Brief",
  ownerKind: "item",
  ownerIds: [1],
  material: 1,
  text: "Lieber Freund.",
  spoken: "Lieber Freund.",
  chars: 14,
  file: "12",
  generatable: true,
  skipReason: null,
  state: "current",
  take: { version: 1, takes: 1, durationSec: 1 } as unknown as ResultLine["take"],
  reportsOpen: 0,
  dirty: false,
  madeBy: null,
  override: null,
};
const result: SearchResult = {
  lines: [page],
  total: 1,
  totalChars: 14,
  counts: { current: 1, stale: 0, missing: 0 },
  dirty: 0,
  offset: 0,
  limit: 50,
};
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/readables/search")
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
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const teams = [
  { id: "t-main", slug: "main-crew", name: "Main Crew", privileged: true },
  { id: "t-second", slug: "second-crew", name: "Second Crew", privileged: false },
];

function explorer(viewed: ViewedTeam | null) {
  render(
    <LangProvider lang="deDE">
      <Explorer books={[]} teams={viewed ? teams : []} viewed={viewed} home="second-crew" />
    </LangProvider>,
  );
}

const named = (name: RegExp) => screen.queryAllByRole("button", { name });
const audioSrc = () => document.querySelector("audio")?.getAttribute("src") ?? null;

test("another team's view asks for its pages and plays its takes, with no write or report", async () => {
  explorer({ team: "t-main", slug: "main-crew", name: "Main Crew", own: false });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Play page 1 of Ein Brief" }));
  await waitFor(() => expect(audioSrc()).not.toBeNull());

  const searches = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/search"));
  expect(searches).not.toHaveLength(0);
  for (const url of searches) expect(new URL(url, "http://x").searchParams.get("team")).toBe("main-crew");
  expect(new URL(audioSrc()!, "http://x").searchParams.get("team")).toBe("main-crew");
  expect(named(/^Override/)).toHaveLength(0);
  expect(named(/regenerate/i)).toHaveLength(0);
  expect(named(/^Report /)).toHaveLength(0);
  expect(named(/^Edit the text/)).toHaveLength(1);
});

test("the visitor's own view keeps every control and sends no team", async () => {
  explorer(null);
  await screen.findByRole("button", { name: "Play page 1 of Ein Brief" });

  for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toContain("team=");
  // Regenerate, Override and Report sit behind the row's More menu once the row has Edit.
  expect(named(/^Report /)).toHaveLength(0);
  expect(named(/^Override/)).toHaveLength(0);
  await userEvent.setup().click(screen.getAllByRole("button", { name: /^More actions for / })[0]);
  expect(named(/^Override/)).toHaveLength(1);
  expect(named(/^Regenerate page/)).toHaveLength(1);
  expect(named(/^Report /)).toHaveLength(1);
});
