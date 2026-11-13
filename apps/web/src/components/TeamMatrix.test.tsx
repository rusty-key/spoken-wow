// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { InviteRow } from "@/lib/invites/store";
import type { Viewer } from "@/lib/permissions";

import TeamMatrix from "./TeamMatrix";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

const DE_ADMIN: Viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
const SITE_ADMIN: Viewer = { role: "admin", grants: [] };

const invite = (over: Partial<InviteRow> = {}): InviteRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "ana@example.com",
  lang: "deDE",
  capabilities: ["edit", "record"],
  invitedById: "u1",
  invitedByName: "Zoe",
  sentAt: "2026-11-01T10:00:00.000Z",
  expiresAt: "2099-11-15T10:00:00.000Z",
  expired: false,
  ...over,
});

function matrix(viewer: Viewer, invites: InviteRow[] = []) {
  return render(
    <TeamMatrix lang="deDE" grants={[]} invites={invites} viewer={viewer} textByTeam={false} currentUserId="me" />,
  );
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("a language admin is offered every capability but text; a site admin text too", () => {
  matrix(DE_ADMIN);
  const form = screen.getByRole("form", { name: /Add someone/ });
  expect(within(form).queryByLabelText("text maintainer")).toBeNull();
  expect(within(form).getByLabelText("voice actor")).toBeTruthy();
  cleanup();
  matrix(SITE_ADMIN);
  expect(within(screen.getByRole("form", { name: /Add someone/ })).getByLabelText("text maintainer")).toBeTruthy();
});

test("submitting sends the chosen capabilities, and an invite is toasted as one", async () => {
  fetchMock.mockResolvedValue(reply({ grants: [], invites: [invite()], invited: true }));
  const user = userEvent.setup();
  matrix(DE_ADMIN);
  await user.type(screen.getByPlaceholderText("their registered email"), "ana@example.com");
  await user.click(within(screen.getByRole("form", { name: /Add someone/ })).getByLabelText("voice actor"));
  await user.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).capabilities).toEqual(["edit", "record"]);
  expect(await screen.findByText(/Invited ana@example.com to German/)).toBeTruthy();
});

test("a pending invite lists its address and can be resent, and Revoke removes it", async () => {
  fetchMock.mockResolvedValue(reply({ grants: [], invites: [] }));
  const user = userEvent.setup();
  matrix(DE_ADMIN, [invite()]);
  expect(screen.getByText("ana@example.com")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Resend/ })).toBeTruthy();
  expect(screen.getByText(/invited by Zoe/)).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Revoke/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/invites/11111111-1111-1111-1111-111111111111");
  expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  await waitFor(() => expect(screen.queryByText("ana@example.com")).toBeNull());
});

test("an expired invite says so", () => {
  matrix(DE_ADMIN, [invite({ expired: true })]);
  expect(screen.getByText(/expired/)).toBeTruthy();
});
