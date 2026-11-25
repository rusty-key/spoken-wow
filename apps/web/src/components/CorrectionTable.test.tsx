// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import CorrectionTable, { type CorrectionRow } from "./CorrectionTable";
import { LangProvider } from "./LangProvider";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

const row: CorrectionRow = {
  id: 7,
  wordings: [
    { lineId: "q:197:progress", variant: 0, editHref: "/quests", before: "¿Cómo va la caza de $n?", split: false, readBy: [] },
  ],
  closest: 0,
  quest: { title: "Domina el raptor", questId: 197, stage: "progress", classWord: false },
  npc: { npcId: 715, npcName: "Hemet Nesingwary" },
  client: { family: "forever", label: "Forever 1.60.1", version: "1.60.1", buildNumber: "70638" },
  locale: "esMX",
  count: 1,
  createdAt: "2026-11-24T05:54:00Z",
  status: "new",
  title: null,
  after: "¿Cómo va la cacería de Tethis?",
  readerGender: null,
  body: null,
  rejectReason: null,
};

const refused = () => Response.json({ error: "The correction has fewer $N.", dropped: ["$N"] }, { status: 409 });
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

async function replaceRefused() {
  fetchMock.mockResolvedValueOnce(refused());
  const user = userEvent.setup();
  render(
    <LangProvider lang="esMX">
      <CorrectionTable source="quests" initial={[row]} />
    </LangProvider>,
  );
  expect(screen.queryByRole("button", { name: /Accept without/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Replace ours" }));
  return user;
}

test("a refusal for a lost token offers the same accept without it, naming the token", async () => {
  const user = await replaceRefused();
  expect(sent(0)).not.toHaveProperty("drops");

  fetchMock.mockResolvedValueOnce(Response.json({ contribution: { text: row.after } }));
  await user.click(await screen.findByRole("button", { name: "Accept without $N" }));

  expect(fetchMock.mock.calls[1][0]).toBe("/api/contributions/correction");
  expect(sent(1)).toMatchObject({ id: 7, lineId: "q:197:progress", variant: 0, drops: ["$N"] });
  expect(await screen.findByRole("button", { name: "Reopen" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Accept without/ })).toBeNull();
});

test("editing the player's text takes the offer away", async () => {
  const user = await replaceRefused();
  await screen.findByRole("button", { name: "Accept without $N" });
  await user.click(screen.getByRole("button", { name: "Edit text" }));
  expect(screen.queryByRole("button", { name: /Accept without/ })).toBeNull();
  // Which tokens to put back is what the moderator needs while editing.
  expect(screen.getByText("The correction has fewer $N.")).toBeTruthy();
});

test("the offer sends the text as typed, where it changed while the accept was in flight", async () => {
  let answer!: (response: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  const user = userEvent.setup();
  render(<CorrectionTable source="quests" initial={[row]} />);
  await user.click(screen.getByRole("button", { name: "Edit text" }));
  const draft = screen.getByLabelText("The player's text");
  await user.type(draft, " A");
  await user.click(screen.getByRole("button", { name: "Replace ours" }));
  await user.type(draft, "B");
  answer(refused());

  fetchMock.mockResolvedValueOnce(Response.json({ contribution: { text: row.after } }));
  await user.click(await screen.findByRole("button", { name: "Accept without $N" }));
  expect(sent(1).text).toBe(`${row.after} AB`);
});

test("any other refusal offers nothing", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Reload first." }, { status: 409 }));
  const user = userEvent.setup();
  render(<CorrectionTable source="quests" initial={[row]} />);
  await user.click(screen.getByRole("button", { name: "Replace ours" }));
  expect(await screen.findByText("Reload first.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Accept without/ })).toBeNull();
});
