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
  branch: "hand-over",
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

  await user.type(screen.getByLabelText("Reason"), "Not a language");
  await user.click(screen.getByRole("button", { name: "Reject" }));

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

  await user.click(screen.getByRole("button", { name: "Approve" }));

  expect((await screen.findByRole("alert")).textContent).toBe("Already decided.");
  expect(screen.getByText("Crew")).toBeTruthy();
});

test("a second-team row says why it cannot be approved yet", () => {
  render(<TeamRequests initial={[request({ branch: "second-team" })]} />);
  expect(screen.getByText("German has a team already; a second team is not possible yet")).toBeTruthy();
});
