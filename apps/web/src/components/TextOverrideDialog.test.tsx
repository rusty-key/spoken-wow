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

test("Save waits for a change that is more than whitespace", async () => {
  const user = userEvent.setup();
  open(null);
  const save = () => screen.getByRole("button", { name: "Save" });

  expect(save()).toHaveProperty("disabled", true);
  await user.type(screen.getByLabelText(/What your team says/), "  ");
  expect(save()).toHaveProperty("disabled", true);
  cleanup();

  open("Der Lichkönig erwacht.");
  await user.type(screen.getByLabelText(/What your team says/), " ");
  expect(save()).toHaveProperty("disabled", true);
});

test("the draft is described by the original", () => {
  open(null);
  const described = screen.getByLabelText(/What your team says/).getAttribute("aria-describedby");
  expect(document.getElementById(described ?? "")?.textContent).toBe("Der Lich erwacht.");
});

test("cancelling drops the draft, so the dialog opens fresh", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "nope" }, { status: 400 }));
  const user = userEvent.setup();
  const { onCancel } = open(null);
  const draft = () => screen.getByLabelText(/What your team says/);

  await user.type(draft(), " Und spricht.");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onCancel).toHaveBeenCalled();
  expect(draft()).toHaveProperty("value", "Der Lich erwacht.");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("saving the original's words over an override removes the override", async () => {
  fetchMock.mockResolvedValue(Response.json({ removed: true }));
  const user = userEvent.setup();
  const { onSaved } = open("Der Lichkönig erwacht.");

  const draft = screen.getByLabelText(/What your team says/);
  await user.clear(draft);
  await user.type(draft, " Der Lich erwacht. ");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("x:7", null));
  const [url, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe("DELETE");
  expect(new URL(url, "http://site").searchParams.get("lineId")).toBe("x:7");
});
