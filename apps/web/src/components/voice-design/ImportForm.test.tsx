// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import ImportForm from "./ImportForm";
import { WorkbenchContext, type Workbench } from "./context";

afterEach(cleanup);

test("says so when reviews.json does not parse, instead of stopping silently", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(
    <WorkbenchContext.Provider value={{ lang: "enUS" } as Workbench}>
      <ImportForm />
    </WorkbenchContext.Provider>,
  );
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["{ nope,"], "reviews.json")] } });
  expect(await screen.findByText(/^reviews\.json: /)).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
