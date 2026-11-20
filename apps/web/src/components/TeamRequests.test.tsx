// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import TeamRequests from "./TeamRequests";
import type { TeamRequest } from "@/lib/teams/requests";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const request = (over: Partial<TeamRequest> = {}): TeamRequest => ({
  id: "r1",
  userId: "u1",
  email: "ana@example.com",
  lang: "deDE",
  langName: null,
  langNative: null,
  teamName: "Crew",
  note: "Hello",
  state: "pending",
  reason: null,
  approvedTeamId: null,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  branch: "add-team",
  ...over,
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

test("rejecting sends the reason and removes the row", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const user = userEvent.setup();
  render(<TeamRequests initial={[request()]} />);

  await user.type(screen.getByLabelText("Reason for Crew"), "Not a language");
  await user.click(screen.getByRole("button", { name: "Reject Crew" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/team-requests/r1");
  expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ decision: "reject", reason: "Not a language" });
  await waitFor(() => expect(screen.queryByText("Crew")).toBeNull());
  expect(refresh).toHaveBeenCalled();
});

test("a refusal shows on the row and the row stays", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Already decided." }), { status: 409 }));
  const user = userEvent.setup();
  render(<TeamRequests initial={[request()]} />);

  await user.click(screen.getByRole("button", { name: "Approve Crew" }));

  expect((await screen.findByRole("alert")).textContent).toBe("Already decided.");
  expect(screen.getByText("Crew")).toBeTruthy();
});

test("a row for a known language says what approving does", () => {
  render(<TeamRequests initial={[request()]} />);
  expect(screen.getByText("Your team joins German, beside any team it has")).toBeTruthy();
});

const deutsch = { id: "00000000-0000-4000-8000-00000000d0de", name: "Deutsch Team" };

const approveBody = async (initial: TeamRequest[], besides: Record<string, typeof deutsch>, tick: boolean) => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const user = userEvent.setup();
  render(<TeamRequests initial={initial} besides={besides} />);
  if (tick) await user.click(screen.getByLabelText("Start from Deutsch Team's voices and settings"));
  await user.click(screen.getByRole("button", { name: "Approve Crew" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return JSON.parse(fetchMock.mock.calls[0][1].body);
};

test("a row for a language with a team copies the team it names only when ticked", async () => {
  const second = [request()];
  expect(await approveBody(second, { r1: deutsch }, true)).toEqual({ decision: "approve", settings: "copy", from: deutsch.id });
  cleanup();
  fetchMock.mockReset();
  expect(await approveBody(second, { r1: deutsch }, false)).toEqual({ decision: "approve", settings: "fresh" });
});

test("a row for a language with a team starts its box unticked", () => {
  render(<TeamRequests initial={[request()]} besides={{ r1: deutsch }} />);
  expect((screen.getByLabelText("Start from Deutsch Team's voices and settings") as HTMLInputElement).checked).toBe(false);
});

test("a row for a language with no team has no box", () => {
  render(<TeamRequests initial={[request()]} besides={{ r2: deutsch }} />);
  expect(screen.getByRole("button", { name: "Approve Crew" })).toBeTruthy();
  expect(screen.queryByLabelText(/Start from/)).toBeNull();
});

test("other rows send no settings", async () => {
  expect(await approveBody([request()], {}, false)).toEqual({ decision: "approve" });
});

test("a request the refresh brings in shows, and a decided one stays gone", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  const user = userEvent.setup();
  const { rerender } = render(<TeamRequests initial={[request()]} />);

  await user.click(screen.getByRole("button", { name: "Reject Crew" }));
  await waitFor(() => expect(screen.queryByText("Crew")).toBeNull());

  rerender(<TeamRequests initial={[request({ id: "r2", teamName: "Other crew" })]} />);
  expect(screen.getByText("Other crew")).toBeTruthy();
  expect(screen.queryByText("Crew")).toBeNull();
});

test("every decision stays disabled while one decision is in flight", async () => {
  let answer!: (response: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
  const user = userEvent.setup();
  render(<TeamRequests initial={[request(), request({ id: "r2", teamName: "Other crew" })]} />);

  await user.click(screen.getByRole("button", { name: "Approve Crew" }));
  const buttons = ["Approve Crew", "Reject Crew", "Approve Other crew", "Reject Other crew"].map(
    (name) => screen.getByRole("button", { name }) as HTMLButtonElement,
  );
  expect(buttons.map((button) => button.disabled)).toEqual([true, true, true, true]);
  await user.click(screen.getByRole("button", { name: "Reject Other crew" }));
  answer(new Response("{}", { status: 200 }));

  await waitFor(() => expect(screen.queryByText("Crew")).toBeNull());
  expect((screen.getByRole("button", { name: "Approve Other crew" }) as HTMLButtonElement).disabled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
