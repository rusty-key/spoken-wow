// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import InviteAccept from "./InviteAccept";

const refresh = vi.fn();
const signOut = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  signOut.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

const props = { email: "ana@example.com", lang: "deDE" as const };

test("signed out, it offers to register or sign in, with no token in either address", () => {
  render(<InviteAccept {...props} signedInAs={null} />);
  expect(screen.getByRole("link", { name: /Register with ana@example.com/ }).getAttribute("href")).toBe("/register");
  expect(screen.getByRole("link", { name: /already have an account/ }).getAttribute("href")).toBe("/login");
});

test("signed in as another address, it names both and offers Sign out, not Accept", async () => {
  signOut.mockResolvedValue({});
  const user = userEvent.setup();
  render(<InviteAccept {...props} signedInAs="bob@example.com" />);
  expect(screen.getByText(/ana@example.com/)).toBeTruthy();
  expect(screen.getByText(/bob@example.com/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

test("signed in as the address, Accept posts the token and shows success", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ lang: "deDE", capabilities: ["edit"] }), { status: 200 }));
  const user = userEvent.setup();
  render(<InviteAccept {...props} signedInAs="Ana@Example.com" />);
  await user.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText(/You're in/)).toBeTruthy();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/invites/accept");
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  expect(refresh).toHaveBeenCalled();
});

test("an already accepted answer shows the same success", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "used", reason: "accepted" }), { status: 409 }));
  const user = userEvent.setup();
  render(<InviteAccept {...props} signedInAs="ana@example.com" />);
  await user.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText(/You're in/)).toBeTruthy();
});

test("any other refusal shows the route's sentence", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: "Zoe can no longer give edit.", reason: "inviter-cannot-grant" }), { status: 409 }),
  );
  const user = userEvent.setup();
  render(<InviteAccept {...props} signedInAs="ana@example.com" />);
  await user.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText("Zoe can no longer give edit.")).toBeTruthy();
  expect(screen.queryByText(/You're in/)).toBeNull();
});
