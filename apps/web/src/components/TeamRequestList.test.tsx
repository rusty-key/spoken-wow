// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import TeamRequestList from "./TeamRequestList";
import type { TeamRequest } from "@/lib/teams/requests";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const request: TeamRequest = {
  id: "r1",
  userId: "u1",
  email: "ana@example.com",
  lang: "deDE",
  langName: null,
  langNative: null,
  teamName: "Crew",
  note: null,
  state: "pending",
  reason: null,
  approvedTeamId: null,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  branch: null,
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

test("withdraw is sent once, however often it is clicked while in flight", async () => {
  let answer!: (response: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
  const user = userEvent.setup();
  render(<TeamRequestList initial={[request]} />);

  const button = screen.getByRole("button", { name: "Withdraw" });
  await user.click(button);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.click(button);
  answer(new Response("{}", { status: 200 }));

  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("every Withdraw stays disabled while one withdrawal is in flight", async () => {
  let answer!: (response: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
  const user = userEvent.setup();
  render(<TeamRequestList initial={[request, { ...request, id: "r2", teamName: "Other crew" }]} />);

  const [first, second] = screen.getAllByRole("button", { name: "Withdraw" }) as HTMLButtonElement[];
  await user.click(first);
  expect(first.disabled).toBe(true);
  expect(second.disabled).toBe(true);
  await user.click(second);
  answer(new Response("{}", { status: 200 }));

  await waitFor(() => expect(second.disabled).toBe(false));
  expect(first.disabled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
