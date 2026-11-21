// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "./LangProvider";
import TextOverrideDrift from "./TextOverrideDrift";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

function drift() {
  const onAnswered = vi.fn();
  render(
    <LangProvider lang="deDE">
      <TextOverrideDrift source="readables" lineId="b:12" text="Ein anderer Wortlaut." onAnswered={onAnswered} />
    </LangProvider>,
  );
  return onAnswered;
}

test("Keep saves the same text again", async () => {
  fetchMock.mockResolvedValue(Response.json({ override: {} }));
  const onAnswered = drift();
  await userEvent.setup().click(screen.getByRole("button", { name: "Keep" }));

  await waitFor(() => expect(onAnswered).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  const query = new URL(url, "http://site").searchParams;
  expect([query.get("source"), query.get("lang")]).toEqual(["readables", "deDE"]);
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ lineId: "b:12", text: "Ein anderer Wortlaut." });
});

test("Drop removes the override", async () => {
  fetchMock.mockResolvedValue(Response.json({ removed: true }));
  const onAnswered = drift();
  await userEvent.setup().click(screen.getByRole("button", { name: "Drop" }));

  await waitFor(() => expect(onAnswered).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe("DELETE");
  expect(new URL(url, "http://site").searchParams.get("lineId")).toBe("b:12");
});

test("a refusal stays on the row", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "unknown line" }, { status: 404 }));
  const onAnswered = drift();
  await userEvent.setup().click(screen.getByRole("button", { name: "Drop" }));

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "unknown line");
  expect(onAnswered).not.toHaveBeenCalled();
});
