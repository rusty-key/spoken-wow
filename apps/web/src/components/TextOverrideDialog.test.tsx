// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "./LangProvider";
import TextOverrideDialog from "./TextOverrideDialog";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

function open(override: string | null, handlers = { onSaved: vi.fn(), onCancel: vi.fn() }) {
  render(
    <LangProvider lang="deDE">
      <TextOverrideDialog
        source="bosses"
        line={{ lineId: "x:7", original: "Der Lich erwacht.", override }}
        {...handlers}
      />
    </LangProvider>,
  );
  return handlers;
}

test("saving PUTs the line and its text to the route and hands the text back", async () => {
  fetchMock.mockResolvedValue(Response.json({ override: {} }));
  const user = userEvent.setup();
  const { onSaved } = open(null);

  const draft = screen.getByLabelText(/What your team says/);
  expect(draft).toHaveProperty("value", "Der Lich erwacht.");
  await user.clear(draft);
  await user.type(draft, "Der Lichkönig erwacht.");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("x:7", "Der Lichkönig erwacht."));
  const [url, init] = fetchMock.mock.calls[0];
  const query = new URL(url, "http://site").searchParams;
  expect(new URL(url, "http://site").pathname).toBe("/api/text-overrides");
  expect(query.get("lang")).toBe("deDE");
  expect(query.get("source")).toBe("bosses");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ lineId: "x:7", text: "Der Lichkönig erwacht." });
});

test("the route's refusal is shown in the dialog", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "this line has no deDE text yet" }, { status: 409 }));
  const user = userEvent.setup();
  const { onSaved } = open(null);

  await user.type(screen.getByLabelText(/What your team says/), " Und spricht.");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "this line has no deDE text yet");
  expect(onSaved).not.toHaveBeenCalled();
});

test("Remove is offered only over an override, and DELETEs it", async () => {
  open(null);
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  cleanup();

  fetchMock.mockResolvedValue(Response.json({ removed: true }));
  const user = userEvent.setup();
  const { onSaved } = open("Der Lichkönig erwacht.");
  expect(screen.getByLabelText(/What your team says/)).toHaveProperty("value", "Der Lichkönig erwacht.");
  await user.click(screen.getByRole("button", { name: "Remove" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("x:7", null));
  const [url, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe("DELETE");
  expect(new URL(url, "http://site").searchParams.get("lineId")).toBe("x:7");
});
