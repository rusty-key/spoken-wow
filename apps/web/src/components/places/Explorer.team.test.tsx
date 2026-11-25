// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import { EN } from "@/lib/ui-text/en";
import type { ResultLine, SearchResult } from "@/lib/places/search";
import type { TeamChoice, ViewedTeam } from "@/lib/teams/viewing";

import { BannerShown } from "@/components/TeamPicker";

import { Explorer } from "./Explorer";
import { placesSection } from "./sections";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/deDE/places",
  useSearchParams: () => navigation.params,
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/components/useCan", () => ({
  useCan: () => (capability: string) => capability === "regenerate" || capability === "text",
}));

const goldshire: ResultLine = {
  id: "s:1429:goldshire",
  kind: "subzone",
  mapID: 1429,
  zoneName: "Elwynn",
  name: "Goldshire",
  text: "A town at a crossroads.",
  spoken: "A town at a crossroads.",
  chars: 23,
  short: true,
  file: "s-1429-goldshire",
  state: "current",
  take: {
    file: "s-1429-goldshire",
    version: 2,
    textHash: "h",
    characters: 23,
    credits: null,
    modelId: null,
    voiceId: null,
    durationSec: 1.5,
    createdAt: "2026-11-01T00:00:00Z",
    takes: 1,
  } as unknown as ResultLine["take"],
  reportsOpen: 0,
  dirty: false,
  madeBy: null,
  override: null,
};

const result: SearchResult = {
  lines: [goldshire],
  total: 1,
  totalChars: 23,
  counts: { all: 1, current: 1, stale: 0, missing: 0 },
  dirty: 0,
  offset: 0,
  limit: 50,
};

const fetchMock = vi.fn();

beforeEach(() => {
  navigation.push.mockReset();
  navigation.params = new URLSearchParams("q=town");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/places/search")
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
  // jsdom has no media playback.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const main: TeamChoice = { id: "t-main", slug: "main-crew", name: "Main Crew" };
const second: TeamChoice = { id: "t-second", slug: "second-crew", name: "Second Crew" };
const mainView: ViewedTeam = { team: main.id, slug: main.slug, name: main.name, own: false };
const ownView: ViewedTeam = { team: second.id, slug: second.slug, name: second.name, own: true };

function explorer(viewed: ViewedTeam | null, teams = [main, second]) {
  render(
    <LangProvider lang="deDE">
      <Explorer
        section={placesSection([], EN.sectionLabels.places)}
        teams={viewed ? teams : []}
        viewed={viewed}
        home={viewed ? second.slug : null}
      />
    </LangProvider>,
  );
}

const searches = () => fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.includes("/search"));
const regenerate = () => screen.queryAllByRole("button", { name: /regenerate/i });
const overrideButton = () => screen.queryByRole("button", { name: "Override the text of Goldshire" });
const pencil = () => screen.queryByRole("button", { name: "Edit the text of Goldshire" });
const audioSrc = () => document.querySelector("audio")?.getAttribute("src") ?? null;

async function playGoldshire() {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Play Goldshire" }));
  await waitFor(() => expect(audioSrc()).not.toBeNull());
}

test("another team's view asks for its takes, and offers no write but the original's pencil", async () => {
  explorer(mainView);
  await screen.findByText("A town at a crossroads.");

  expect(searches()).not.toHaveLength(0);
  for (const url of searches()) expect(new URL(url, "http://x").searchParams.get("team")).toBe("main-crew");
  expect(regenerate()).toHaveLength(0);
  expect(overrideButton()).toBeNull();
  expect(pencil()).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).toBeNull();
  expect(screen.getByText("You are listening to Main Crew. Their takes play; their work is theirs.")).not.toBeNull();
  // No queue or generation status is read for a team the visitor cannot act on.
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/regenerate/queue"))).toBe(false);

  await playGoldshire();
  expect(new URL(audioSrc()!, "http://x").searchParams.get("team")).toBe("main-crew");
});

for (const [name, viewed] of [
  ["the visitor's own team", ownView],
  ["a language with one team, or none", null],
] as const) {
  test(`${name} keeps today's controls and sends no team`, async () => {
    explorer(viewed);
    await screen.findByText("A town at a crossroads.");

    for (const url of searches()) expect(url).not.toContain("team=");
    expect(pencil()).not.toBeNull();
    // Regenerate, Override and Report sit behind the row's More menu once the row has Edit.
    expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).toBeNull();
    expect(overrideButton()).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "More actions for Goldshire" }));
    expect(regenerate()).not.toHaveLength(0);
    expect(overrideButton()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).not.toBeNull();
    expect(screen.queryByText(/You are listening to/)).toBeNull();

    await playGoldshire();
    expect(audioSrc()).not.toContain("team=");
  });
}

test("no picker shows without a second team", async () => {
  explorer(null);
  await screen.findByText("A town at a crossroads.");
  expect(screen.queryByLabelText("Team")).toBeNull();
});

test("picking a team names it in the URL, and picking the default drops it, keeping the rest", async () => {
  const user = userEvent.setup();
  explorer(ownView);
  await user.selectOptions(await screen.findByLabelText("Team"), "main-crew");
  expect(navigation.push).toHaveBeenLastCalledWith("/deDE/places?q=town&team=main-crew", { scroll: false });

  cleanup();
  navigation.params = new URLSearchParams("q=town&team=main-crew");
  explorer(mainView);
  await user.selectOptions(await screen.findByLabelText("Team"), "second-crew");
  expect(navigation.push).toHaveBeenLastCalledWith("/deDE/places?q=town", { scroll: false });
});

test("below a site owner's acting banner the explorer shows no picker of its own", async () => {
  render(
    <LangProvider lang="deDE">
      <BannerShown shown>
        <Explorer
          section={placesSection([], EN.sectionLabels.places)}
          teams={[main, second]}
          viewed={ownView}
          home={second.slug}
        />
      </BannerShown>
    </LangProvider>,
  );
  await screen.findByText("A town at a crossroads.");
  expect(screen.queryByLabelText("Team")).toBeNull();
});
