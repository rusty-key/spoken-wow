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
  render(<TeamsTable initial={[]} takes={{}} languages={languages} />);
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
  render(<TeamsTable initial={[]} takes={{}} languages={languages} />);
  await fillBasics(user);
  await user.selectOptions(screen.getByLabelText("Languages"), "deDE");
  await user.click(screen.getByRole("button", { name: "Create team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.langs).toEqual(["deDE"]);
  expect(body).not.toHaveProperty("newLanguage");
});
