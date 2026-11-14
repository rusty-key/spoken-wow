// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import TeamRequestForm from "./TeamRequestForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const languages = [{ code: "deDE", name: "German" }];
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

const bodyOf = () => JSON.parse(fetchMock.mock.calls[0][1].body);

test("a new language asks for its code and names, and posts them", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const user = userEvent.setup();
  render(<TeamRequestForm languages={languages} />);

  expect(screen.queryByLabelText("Language code")).toBeNull();
  await user.selectOptions(screen.getByLabelText("Language"), "New language…");
  await user.type(screen.getByLabelText("Language code"), "xqAG");
  await user.type(screen.getByLabelText("Name in English"), "Testish");
  await user.type(screen.getByLabelText("Name in the language itself"), "Testisch");
  await user.type(screen.getByLabelText("Team name"), "Crew");
  await user.click(screen.getByRole("button", { name: "Send request" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/team-requests");
  expect(bodyOf()).toEqual({ lang: "xqAG", language: { name: "Testish", native: "Testisch" }, teamName: "Crew" });
});

test("a known language posts no names", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const user = userEvent.setup();
  render(<TeamRequestForm languages={languages} />);

  await user.selectOptions(screen.getByLabelText("Language"), "deDE");
  await user.type(screen.getByLabelText("Team name"), "Crew");
  await user.click(screen.getByRole("button", { name: "Send request" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(bodyOf()).toEqual({ lang: "deDE", teamName: "Crew" });
});

test("a refusal's text is shown", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "You already have a pending request." }), { status: 409 }),
  );
  const user = userEvent.setup();
  render(<TeamRequestForm languages={languages} />);

  await user.selectOptions(screen.getByLabelText("Language"), "deDE");
  await user.type(screen.getByLabelText("Team name"), "Crew");
  await user.click(screen.getByRole("button", { name: "Send request" }));

  expect((await screen.findByRole("alert")).textContent).toBe("You already have a pending request.");
});
