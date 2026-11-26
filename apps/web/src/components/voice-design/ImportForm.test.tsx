// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import ImportForm, { pick } from "./ImportForm";
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

const at = (path: string, body = "x") => {
  const file = new File([body], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};

test("takes every version folder under the pick and the reviews.json nearest its top", async () => {
  const picked = await pick([
    at("voice-lab/reviews.json", JSON.stringify({ "orc-male-shady-v2": [{ status: "good" }] })),
    at("voice-lab/out/old/reviews.json", "{ not even json"),
    at("voice-lab/voices/orc-male-shady-v2/meta.json"),
    at("voice-lab/voices/orc-male-shady-v2/preview0.mp3"),
    at("voice-lab/voices/orc-male-shady-v2/line1.mp3"),
    at("voice-lab/voices/orc-male-shady-v2/live-line1.mp3"),
    at("voice-lab/voices/troll-male-dark-v1/meta.json"),
    at("voice-lab/refs/orc-male-shady.mp3"),
    at("voice-lab/out/backup/orc-male-shady-v2/preview1.mp3"),
  ]);
  expect([...picked.folders.keys()].sort()).toEqual(["orc-male-shady-v2", "troll-male-dark-v1"]);
  expect(picked.folders.get("orc-male-shady-v2")!.map((f) => f.name)).toEqual(["meta.json", "preview0.mp3", "line1.mp3"]);
  expect(picked.reviews).toEqual({ "orc-male-shady-v2": [{ status: "good" }] });
});
