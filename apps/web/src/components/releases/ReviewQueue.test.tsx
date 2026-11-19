// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/toast";
import type { WaitingVersion } from "@/lib/releases/sections";

import ReviewQueue from "./ReviewQueue";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const version: WaitingVersion = {
  id: "11111111-1111-1111-1111-111111111111",
  team: { id: "t1", slug: "stimmen", name: "Stimmen" },
  lang: "deDE",
  section: "places",
  version: "1.0.3",
  by: "Ana",
  pressedAt: "2026-11-18T10:00:00Z",
  error: null,
  approving: false,
  pending: {
    since: "2026-11-01T10:00:00Z",
    count: 2,
    restored: 0,
    textChanges: 1,
    people: [{ id: "u1", name: "Ana", count: 2 }],
    changes: [],
  },
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

const show = (waiting: WaitingVersion[]) =>
  render(
    <Toaster>
      <ReviewQueue waiting={waiting} />
    </Toaster>,
  );

test("lists a waiting version with its team, counts and a link to the team's takes in the explorer", () => {
  show([version]);
  expect(screen.getByText("Stimmen")).toBeTruthy();
  expect(screen.getByText("2 lines")).toBeTruthy();
  expect(screen.getByText(/1 text changes/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open in the explorer" }).getAttribute("href")).toContain("team=stimmen");
});

test("rejecting needs a reason before it can be sent, and sends it", async () => {
  const user = userEvent.setup();
  show([version]);
  await user.click(screen.getByRole("button", { name: "Reject…" }));
  const reject = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
  expect(reject.disabled).toBe(true);
  await user.type(screen.getByLabelText("Why it is not approved"), "   ");
  expect(reject.disabled).toBe(true);
  await user.type(screen.getByLabelText("Why it is not approved"), "Too quiet");
  expect(reject.disabled).toBe(false);
  await user.click(reject);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`/api/releases/${version.id}/review`);
  expect(JSON.parse(init.body)).toEqual({ action: "reject", note: "Too quiet" });
});

test("approving sends the approval, and a version being listed cannot be approved again", async () => {
  const user = userEvent.setup();
  show([version, { ...version, id: "22222222-2222-2222-2222-222222222222", approving: true }]);
  const [approve, listing] = screen.getAllByRole("button", { name: /Approve|Being listed/ }) as HTMLButtonElement[];
  expect(listing.disabled).toBe(true);
  await user.click(approve);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "approve" });
});

test("says when nothing waits", () => {
  show([]);
  expect(screen.getByText("Nothing waiting.")).toBeTruthy();
});

test("asks for a version's lines only when Read and listen opens it", async () => {
  const user = userEvent.setup();
  const line = { file: "z:1", lineId: "z:1", version: 1, at: "2026-11-02T10:00:00Z", byId: "u1", by: "Ana", kind: "new", title: "Elwynn", text: "Hallo" };
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ pending: { ...version.pending, changes: [line] } }), { status: 200 }));
  show([version]);
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Read and listen" }));
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/releases/${version.id}/review`);
  expect(await screen.findByText("“Hallo”")).toBeTruthy();
});
