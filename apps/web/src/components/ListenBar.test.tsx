// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import ListenBar from "./ListenBar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

// This jsdom has no localStorage of its own.
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
});

afterEach(() => {
  cleanup();
  stored.clear();
});

const shown = () => !(screen.getByText("Help us design new voices").closest(".listen-bar") as HTMLElement).hidden;

const bar = () => <ListenBar text="Help us design new voices" cta="Listen and vote" close="Close" />;

test("closes, and stays closed on the next page", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  render(bar());
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(shown()).toBe(false);
  cleanup();

  render(bar());
  expect(shown()).toBe(false);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test("shows to a visitor who never closed it", () => {
  render(bar());
  expect(shown()).toBe(true);
});
