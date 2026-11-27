// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { PublicVoice } from "@/lib/voice-feedback/public";

import Listen from "./Listen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

// Most of these look at the table, which the page opens only when the address asks for it.
beforeEach(() => window.history.replaceState(null, "", "/listen#table"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("lands on the cards when the address names no view", () => {
  window.history.replaceState(null, "", "/listen");
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  expect(screen.queryAllByRole("row")).toHaveLength(0);
  expect(screen.getByText("1 of 3")).toBeTruthy();
});

const voice = (slot: string, showingId: number, archetype: string | null = null): PublicVoice => {
  const [race, gender, ...rest] = slot.split("-");
  return {
    slot,
    race,
    gender,
    flavor: rest.length ? rest.join("-") : null,
    archetype,
    examples: ["Grunt", "Zug", "Mok"],
    showingId,
    samples: [0, 1, 2].map((n) => ({ sha256: `${showingId}${n}`.padEnd(64, "0"), text: `Line ${n} of ${slot}`, npcName: "Grunt" })),
  };
};

const VOICES = [voice("orc-male-shady", 1, "Back-alley fence"), voice("orc-female", 2), voice("human-male-guard", 3, "City watchman")];

const rows = () => screen.getAllByRole("row").slice(1);

test("lists every voice with its character, three lines and the vote buttons", () => {
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  expect(rows()).toHaveLength(3);
  const first = within(rows()[0]);
  expect(first.getByText("Orc · Male · Shady")).toBeTruthy();
  expect(first.getByText("Back-alley fence")).toBeTruthy();
  expect(first.getByText("Grunt, Zug, Mok")).toBeTruthy();
  expect(first.getAllByRole("button", { name: /Line \d/ })).toHaveLength(3);
  for (const name of ["Fits", "Close", "Doesn't fit", "Skip"]) expect(first.getByRole("button", { name })).toBeTruthy();
});

test("filters by race, gender or flavor, and by whether you voted", async () => {
  render(<Listen lang="enUS" voices={VOICES} votes={{ 2: { verdict: "skip", note: "" } }} />);
  await userEvent.type(screen.getByRole("searchbox"), "orc");
  expect(rows()).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: /Not voted/ }));
  expect(rows()).toHaveLength(1);
  expect(within(rows()[0]).getByText("Orc · Male · Shady")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /^Voted/ }));
  expect(within(rows()[0]).getByText("Orc · Female")).toBeTruthy();
});

test("sends the vote with the note typed before it, and marks the voice voted", async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  const first = within(rows()[0]);
  await userEvent.type(first.getByRole("textbox", { name: "Note" }), "too young");
  await userEvent.click(first.getByRole("button", { name: "Doesn't fit" }));

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/listen/votes");
  expect(JSON.parse(String(init.body))).toEqual({ showingId: 1, verdict: "off", note: "too young" });
  expect(first.getByRole("button", { name: "Doesn't fit" }).getAttribute("aria-pressed")).toBe("true");
});

test("shows one voice at a time in cards, and moves on with Next", async () => {
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  await userEvent.click(screen.getByRole("button", { name: "One at a time" }));
  expect(screen.queryAllByRole("row")).toHaveLength(0);
  expect(screen.getByText("1 of 3")).toBeTruthy();
  const seen = new Set<string>();
  for (let n = 0; n < 3; n += 1) {
    seen.add(screen.getByRole("heading", { level: 2 }).textContent ?? "");
    if (n < 2) await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  expect(seen.size).toBe(3);
  // A card spells each line out; the table keeps them in tooltips.
  expect(screen.getByText(/^Grunt: Line 0 of /)).toBeTruthy();
});

test("deals cards from the voices not voted yet, with no filters, and keeps a card in place once it is voted", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  render(<Listen lang="enUS" voices={VOICES} votes={{ 2: { verdict: "skip", note: "" } }} />);
  await userEvent.type(screen.getByRole("searchbox"), "human");
  await userEvent.click(screen.getByRole("button", { name: "One at a time" }));
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /Not voted/ })).toBeNull();
  expect(screen.getByText("1 of 2")).toBeTruthy();

  const name = screen.getByRole("heading", { level: 2 }).textContent;
  await userEvent.click(screen.getByRole("button", { name: "Fits" }));
  // Still here, so a note can follow the answer.
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(name);
  expect(screen.getByText("1 of 2")).toBeTruthy();
});

test("opens the view the address names, and names the view chosen", async () => {
  window.history.replaceState(null, "", "/listen#cards");
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  expect(screen.queryAllByRole("row")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(window.location.hash).toBe("#table");
  expect(rows()).toHaveLength(3);
});

test("keeps an answer's label in place while the vote sends, so the button does not change width", async () => {
  let answer: (value: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
  render(<Listen lang="enUS" voices={VOICES} votes={{}} />);
  const fits = within(rows()[0]).getByRole("button", { name: "Fits" });
  await userEvent.click(fits);
  expect(fits.getAttribute("aria-busy")).toBe("true");
  // The label stays, hidden under the spinner, rather than the spinner pushing in beside it.
  expect(fits.querySelector(".ls-verdict-label")?.textContent).toBe("Fits");
  expect(fits.querySelector("svg")?.classList.contains("ls-verdict-spinner")).toBe(true);
  answer(Response.json({ ok: true }));
});
