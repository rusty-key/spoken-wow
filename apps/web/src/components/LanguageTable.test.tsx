// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import LanguageTable from "./LanguageTable";

const rows = [
  { code: "enUS", name: "English", enabled: true },
  { code: "deDE", name: "German", enabled: false },
];
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

test("while a switch is in flight, adding a language waits, so the switch's older list cannot drop it", async () => {
  let answer!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
  const user = userEvent.setup();
  render(<LanguageTable initial={rows} />);

  await user.click(screen.getByRole("checkbox", { name: /German/ }));
  const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  await user.type(screen.getByLabelText("Code"), "jaJP{Enter}");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  answer(new Response(JSON.stringify({ languages: [rows[0], { ...rows[1], enabled: true }] }), { status: 200 }));
  await waitFor(() => expect(add.disabled).toBe(false));
  expect((screen.getByRole("checkbox", { name: /German/ }) as HTMLButtonElement).disabled).toBe(false);
});
