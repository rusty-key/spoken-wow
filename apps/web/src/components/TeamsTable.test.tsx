// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import TeamsTable from "./TeamsTable";
import type { Lang } from "@/lib/lang";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const languages = [{ code: "deDE" as Lang, name: "German" }];
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Slug"), "german");
  await user.type(screen.getByLabelText("Name"), "German team");
}

test("the new-language toggle sends newLanguage and no langs", async () => {
  const user = userEvent.setup();
  render(<TeamsTable initial={[]} languages={languages} />);
  await fillBasics(user);
  await user.click(screen.getByLabelText("New language…"));
  expect((screen.getByLabelText("Languages") as HTMLSelectElement).disabled).toBe(true);
  await user.type(screen.getByLabelText("Language code"), "nlNL");
  await user.type(screen.getByLabelText("Name in English"), "Dutch");
  await user.type(screen.getByLabelText("Name in the language itself"), "Nederlands");
  await user.click(screen.getByRole("button", { name: "Create team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.newLanguage).toEqual({ code: "nlNL", name: "Dutch", native: "Nederlands" });
  expect(body).not.toHaveProperty("langs");
});

test("with the toggle off, the chosen languages are sent and no newLanguage", async () => {
  const user = userEvent.setup();
  render(<TeamsTable initial={[]} languages={languages} />);
  await fillBasics(user);
  await user.selectOptions(screen.getByLabelText("Languages"), "deDE");
  await user.click(screen.getByRole("button", { name: "Create team" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.langs).toEqual(["deDE"]);
  expect(body).not.toHaveProperty("newLanguage");
});

const team = (langs: Lang[]) => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "spare",
  name: "Spare",
  ownStorage: true,
  official: true,
  langs,
  base: false,
  members: [],
  deleting: null,
});

const preview = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "spare",
  name: "Spare",
  langs: [
    { lang: "deDE", alone: false },
    { lang: "plPL", alone: true },
  ],
  members: [
    { email: "a@example.invalid", lang: "deDE", capability: "admin" },
    { email: "a@example.invalid", lang: "plPL", capability: "record" },
  ],
  counts: Object.fromEntries(
    [
      "regeneration_job", "regeneration_batch", "regeneration_pause", "queue_dismissal", "take_ack", "take", "recording",
      "line_flag", "line_issue_line", "line_issue", "line_ignore", "line_override", "text_override", "voice_assignment",
      "voice", "voice_clone", "voice_sample", "fish_reference", "generation_setting_locale", "generation_setting",
      "npc_direction_locale",
      "lexicon_change", "pronunciation_lexicon_locale", "pronunciation_lexicon", "release_run", "archive_object",
      "storage_move", "storage_backend", "activity", "report",
    ].map((table) => [table, 0]),
  ),
  reports: { moving: 0, closing: 0 },
  pending: 0,
  packs: [],
  refusal: null,
  ...overrides,
});

function answer(body: unknown) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method ? new Response("{}", { status: 200 }) : new Response(JSON.stringify(body), { status: 200 }),
  );
}

test("any team can be deleted but English's first", () => {
  render(
    <TeamsTable
      initial={[team(["enUS" as Lang]), { ...team(["enUS" as Lang]), id: "e", slug: "english", base: true }]}
      languages={languages}
    />,
  );
  expect((screen.getByRole("button", { name: "Delete spare" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Delete english" }) as HTMLButtonElement).disabled).toBe(true);
});

test("the dialog says what goes in plain words, and deletes only once the slug is typed", async () => {
  const user = userEvent.setup();
  answer(
    preview({
      counts: { ...preview().counts, take: 312, voice: 12, report: 5, storage_backend: 1 },
      reports: { moving: 3, closing: 2 },
      pending: 40,
      packs: [
        { lang: "deDE", section: "quests", version: "1.0.4" },
        { lang: "plPL", section: "places", version: "1.0.1" },
      ],
    }),
  );
  render(<TeamsTable initial={[team(["deDE" as Lang, "plPL" as Lang])]} languages={[...languages, { code: "plPL" as Lang, name: "Polish" }]} />);
  await user.click(screen.getByRole("button", { name: "Delete spare" }));

  expect(await screen.findByText("2 packs will be delisted first: Quests in German, Places in Polish.")).toBeTruthy();
  expect(screen.getByText("312 takes and their history; the audio files stay in the bucket.")).toBeTruthy();
  expect(screen.getByText("40 lines waiting to generate will be cancelled.")).toBeTruthy();
  expect(screen.getByText("3 text reports will move to another team of the language, or to its text queue.")).toBeTruthy();
  expect(screen.getByText("2 open voice reports will be closed: their takes go with the team.")).toBeTruthy();
  expect(screen.getByText("Its storage bucket is forgotten; everything in it stays.")).toBeTruthy();
  expect(screen.getByText("1 person will lose what they do in it; text maintainers keep theirs.")).toBeTruthy();
  expect(screen.getByText("Polish will be hidden: it has no other team.")).toBeTruthy();
  expect(screen.queryByText(/German will be hidden/)).toBeNull();

  const remove = screen.getByRole("button", { name: "Delete team" }) as HTMLButtonElement;
  expect(remove.disabled).toBe(true);
  await user.type(screen.getByLabelText("Team slug"), "spar");
  expect(remove.disabled).toBe(true);
  await user.type(screen.getByLabelText("Team slug"), "e");
  expect(remove.disabled).toBe(false);
  await user.click(remove);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][0]).toBe("/api/teams/00000000-0000-0000-0000-000000000001");
  expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ slug: "spare" });
  expect(refresh).toHaveBeenCalled();
});

test("the dialog shows why a team cannot be deleted now, and offers no delete", async () => {
  const user = userEvent.setup();
  answer(preview({ refusal: "spare has a release under way; delete it once that is finished." }));
  render(<TeamsTable initial={[team(["deDE" as Lang])]} languages={languages} />);
  await user.click(screen.getByRole("button", { name: "Delete spare" }));
  expect(await screen.findByText("spare has a release under way; delete it once that is finished.")).toBeTruthy();
  expect(screen.queryByLabelText("Team slug")).toBeNull();
  expect((screen.getByRole("button", { name: "Delete team" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a team being deleted says how far it is, and one that stopped offers a Retry", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <TeamsTable initial={[{ ...team(["deDE" as Lang]), deleting: { delisted: 1, delists: 4, error: null } }]} languages={languages} />,
  );
  expect(screen.getByText("Being deleted: taking its packs off the channel, 1 of 4 done")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete spare" })).toBeNull();

  rerender(
    <TeamsTable
      initial={[{ ...team(["deDE" as Lang]), deleting: { delisted: 0, delists: 1, error: "Taking quests in deDE off the channel failed: boom" } }]}
      languages={languages}
    />,
  );
  expect(screen.getByText("Deletion stopped: Taking quests in deDE off the channel failed: boom")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry deleting spare" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/teams/00000000-0000-0000-0000-000000000001/deletion");
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});

test("a saved checkbox shows what the refresh after the save read, even when another owner changed it back", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<TeamsTable initial={[team([])]} languages={languages} />);
  const official = () => screen.getByLabelText("spare is official") as HTMLInputElement;
  const ownStorage = () => screen.getByLabelText("spare's new audio goes only to its own bucket") as HTMLInputElement;

  await user.click(official());
  await waitFor(() => expect(official().disabled).toBe(false));
  expect(official().checked).toBe(false);
  await user.click(ownStorage());
  await waitFor(() => expect(ownStorage().disabled).toBe(false));
  expect(ownStorage().checked).toBe(false);

  // Before the refresh read the team, another owner saved both back to true.
  rerender(<TeamsTable initial={[team([])]} languages={languages} />);
  expect(official().checked).toBe(true);
  expect(ownStorage().checked).toBe(true);
});

test("a team's languages are listed alike, with no way to move one", () => {
  render(<TeamsTable initial={[team(["deDE" as Lang, "frFR" as Lang])]} languages={languages} />);
  expect(screen.getByText("deDE")).toBeTruthy();
  expect(screen.getByText("frFR")).toBeTruthy();
  expect(screen.queryByText(/second team/)).toBeNull();
  expect(screen.queryByLabelText(/Move .* to/)).toBeNull();
});
