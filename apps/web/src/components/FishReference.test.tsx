// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import FishReference, { type ReferenceView } from "./FishReference";

const samples = [{ file: "clip.mp3", bytes: 1000, uploadedAt: "2026-11-18T00:00:00Z" }];
const cut: ReferenceView = {
  sample: "clip.mp3",
  startSec: 0,
  endSec: 20,
  transcript: "Hello there.",
  clipHash: "hash",
  pinned: false,
};
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

function panel(initial: ReferenceView | null, onChange = vi.fn()) {
  render(
    <FishReference
      voice="satyr-male"
      samples={samples}
      hasSeedClips={false}
      onSamples={vi.fn()}
      initial={initial}
      onChange={onChange}
    />,
  );
  return onChange;
}

test("a proxy's error page in place of the route's JSON shows its status, not a parse error", async () => {
  fetchMock.mockResolvedValueOnce(new Response("<html>504 Gateway Time-out</html>", { status: 504 }));
  panel(null);

  await userEvent.setup().click(screen.getByRole("button", { name: "Cut reference" }));
  expect(await screen.findByText("failed (504)")).toBeTruthy();
});

test("a success whose body does not parse keeps the reference the panel showed", async () => {
  fetchMock.mockResolvedValueOnce(new Response('{"reference":', { status: 200 }));
  const onChange = panel(cut);

  const recut = screen.getByRole("button", { name: "Re-cut" }) as HTMLButtonElement;
  await userEvent.setup().click(recut);
  // The failure is reported, whatever words the parser chose for it, and nothing else moved.
  expect((await screen.findByRole("alert")).textContent).not.toBe("");
  await waitFor(() => expect(recut.disabled).toBe(false));
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByDisplayValue("Hello there.") as HTMLTextAreaElement).value).toBe("Hello there.");
});
