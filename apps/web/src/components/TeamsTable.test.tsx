// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import TeamsTable from "./TeamsTable";
import type { Lang } from "@/lib/lang";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const languages = [{ code: "deDE" as Lang, name: "German" }];
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Slug"), "german");
  await user.type(screen.getByLabelText("Name"), "German team");
}

test("the new-language toggle sends newLanguage and no langs", async () => {
  const user = userEvent.setup();
  render(<TeamsTable initial={[]} languages={languages} />);
  await fillBasics(user);
  await user.click(screen.getByLabelText("New language…"));
  expect((screen.getByLabelText("Languages") as HTMLSelectElement).disabled).toBe(true);
  await user.type(screen.getByLabelText("Language code"), "nlNL");
  await user.type(screen.getByLabelText("Name in English"), "Dutch");
  await user.type(screen.getByLabelText("Name in the language itself"), "Nederlands");
  await user.click(screen.getByRole("button", { name: "Create team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.newLanguage).toEqual({ code: "nlNL", name: "Dutch", native: "Nederlands" });
  expect(body).not.toHaveProperty("langs");
});

test("with the toggle off, the chosen languages are sent and no newLanguage", async () => {
  const user = userEvent.setup();
  render(<TeamsTable initial={[]} languages={languages} />);
  await fillBasics(user);
  await user.selectOptions(screen.getByLabelText("Languages"), "deDE");
  await user.click(screen.getByRole("button", { name: "Create team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.langs).toEqual(["deDE"]);
  expect(body).not.toHaveProperty("newLanguage");
});

const team = (langs: Lang[]) => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "spare",
  name: "Spare",
  ownStorage: true,
  official: true,
  langs,
  members: [],
});

test("a team holding a language cannot be deleted", () => {
  render(<TeamsTable initial={[team(["deDE" as Lang])]} languages={languages} />);
  expect((screen.getByRole("button", { name: "Delete spare" }) as HTMLButtonElement).disabled).toBe(true);
});

test("deleting asks first, then sends DELETE for the team", async () => {
  const user = userEvent.setup();
  render(<TeamsTable initial={[team([])]} languages={languages} />);
  await user.click(screen.getByRole("button", { name: "Delete spare" }));
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/teams/00000000-0000-0000-0000-000000000001");
  expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  expect(refresh).toHaveBeenCalled();
});

test("a saved checkbox shows what the refresh after the save read, even when another owner changed it back", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<TeamsTable initial={[team([])]} languages={languages} />);
  const official = () => screen.getByLabelText("spare is official") as HTMLInputElement;
  const ownStorage = () => screen.getByLabelText("spare's new audio goes only to its own bucket") as HTMLInputElement;

  await user.click(official());
  await waitFor(() => expect(official().disabled).toBe(false));
  expect(official().checked).toBe(false);
  await user.click(ownStorage());
  await waitFor(() => expect(ownStorage().disabled).toBe(false));
  expect(ownStorage().checked).toBe(false);

  // Before the refresh read the team, another owner saved both back to true.
  rerender(<TeamsTable initial={[team([])]} languages={languages} />);
  expect(official().checked).toBe(true);
  expect(ownStorage().checked).toBe(true);
});

test("a team's languages are listed alike, with no way to move one", () => {
  render(<TeamsTable initial={[team(["deDE" as Lang, "frFR" as Lang])]} languages={languages} />);
  expect(screen.getByText("deDE")).toBeTruthy();
  expect(screen.getByText("frFR")).toBeTruthy();
  expect(screen.queryByText(/second team/)).toBeNull();
  expect(screen.queryByLabelText(/Move .* to/)).toBeNull();
});
