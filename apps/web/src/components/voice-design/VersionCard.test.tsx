// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { Design } from "@/lib/voice-design/types";

import VersionCard from "./VersionCard";
import { WorkbenchContext, type Workbench } from "./context";
import type { SlotView } from "./Workbench";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sample = (position: number, sha: string) => ({ position, sha256: sha.repeat(64), lineId: `q:${position}`, text: `line ${sha}`, npcName: "Grunt", characters: 6, credits: 3 });

const DESIGN: Design = {
  id: "d1",
  lang: "enUS",
  slot: "orc-male-shady",
  version: 2,
  prompt: "p",
  previewText: "t",
  previews: [{ generatedVoiceId: "g", sha256: "f".repeat(64), measures: null }],
  chosenPreview: 0,
  voiceId: "v",
  voiceName: "design-orc-male-shady-v2",
  holderId: "u1",
  holderName: "Ann",
  voiceDeletedAt: null,
  sampleModel: "eleven_v4",
  analysisId: null,
  note: null,
  analysis: null,
  samples: [sample(0, "a"), sample(1, "b"), sample(2, "c")],
  sampledAt: "2026-11-25T00:00:00Z",
  reviews: [{ id: 1, status: "needs-work", note: "", bestPreview: 0, clips: { "sample:2": "off", "preview:0": "good" }, players: [], createdBy: "u1", createdByName: "Ann", createdAt: "2026-11-26T00:00:00Z" }],
  isPublic: false,
  playersHearOlderLines: false,
  showings: [],
  createdBy: "u1",
  createdByName: "Ann",
  createdAt: "2026-11-26T00:00:00Z",
};

const context: Workbench = {
  lang: "enUS",
  viewer: { id: "u1", designs: true, admin: false },
  keys: { elevenlabs: true, gemini: true },
  rate: 0.5,
  model: "eleven_v4",
  live: {},
  play: () => {},
  isPlaying: () => false,
  drafts: {},
  setDraft: () => {},
  updateDesign: () => {},
  updateAnalysis: () => {},
  removeDesign: () => {},
  remixSettings: { promptStrength: 0.5, guidanceScale: null, loudness: null, seed: 9 },
  setRemixSettings: () => {},
};

/** A verdict button: the sample lines' marks are named Good too. */
const verdict = (name: string) => within(screen.getByRole("textbox", { name: "Note" }).closest(".vd-review-form") as HTMLElement).getByRole("button", { name });

const card = (design: Design) => (
  <WorkbenchContext.Provider value={context}>
    <VersionCard design={design} slot={{ name: design.slot, sampleChars: 0, reference: null, previewLines: {}, designs: [design] } as unknown as SlotView} newest />
  </WorkbenchContext.Provider>
);

test("drops the marks on lines that a re-sample replaced, and the preview marks nobody can see", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(card(DESIGN));
  rerender(card({ ...DESIGN, samples: [sample(0, "d"), sample(1, "e"), sample(2, "f")], sampledAt: "2026-11-27T00:00:00Z" }));

  await userEvent.click(verdict("Good"));
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body.clips).toEqual({});
});

test("saves the preview whose button is pressed, the recommended one marked out", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const measured = (ess: number) => ({ ess, decay: -20, level: -12 });
  const fresh: Design = {
    ...DESIGN,
    voiceId: null,
    voiceName: null,
    holderId: null,
    chosenPreview: null,
    reviews: [],
    samples: [],
    previews: [0, 1, 2].map((n) => ({ generatedVoiceId: `g${n}`, sha256: String(n).repeat(64), measures: measured([0.5, 0.02, 0.4][n]) })),
  };
  render(card(fresh));
  const saves = screen.getAllByRole("button", { name: "Save as voice" });
  expect(saves.map((button) => button.classList.contains("bs-btn-primary"))).toEqual([false, true, false]);

  await userEvent.click(saves[2]);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(`/api/voices/design/${DESIGN.id}/voice`);
  expect(JSON.parse(String(init.body))).toEqual({ preview: 2 });
});

test("removes a verdict only after it is confirmed", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: { ...DESIGN, reviews: [] } }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Remove this verdict" }));
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(`/api/voices/design/${DESIGN.id}/reviews/1`);
  expect(init.method).toBe("DELETE");
});

test("offers to save another preview once the voice is deleted from ElevenLabs", () => {
  render(card({ ...DESIGN, voiceDeletedAt: "2026-11-26T00:00:00Z" }));
  expect(screen.getAllByRole("button", { name: "Save as voice" })).toHaveLength(DESIGN.previews.length);
});

test("gives a verdict in one press, with the note, and drops the marks of a verdict that was removed", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(card(DESIGN));
  rerender(card({ ...DESIGN, reviews: [] }));

  await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "sounds female");
  await userEvent.click(verdict("Needs work"));
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body).toMatchObject({ status: "needs-work", note: "sounds female", clips: {} });
});

test("generates the next version from the review in one press: Gemini's prompt, then Voice Design", async () => {
  const revision = { heard: "too noble", prompt: "A colder voice.", preview_text: "y".repeat(120), archetype: "Queen" };
  const fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: { ...DESIGN, id: "d2", version: 3 }, retired: [] }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Generate from review" }));
  const [designUrl, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(designUrl).toMatch(/\/api\/voices\/design(\?|$)/);
  expect(JSON.parse(String(init.body))).toMatchObject({ slot: DESIGN.slot, prompt: "A colder voice.", previewText: "y".repeat(120), revisionHeard: "too noble", archetype: "Queen" });
});

test("loads only marks that still apply: none from before the lines were voiced again, none on lines that are gone", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const sent = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)).clips;

  render(card(DESIGN));
  await userEvent.click(verdict("Good"));
  expect(sent()).toEqual({ "sample:2": "off" });
  cleanup();

  render(card({ ...DESIGN, sampledAt: "2026-11-27T00:00:00Z" }));
  await userEvent.click(verdict("Good"));
  expect(sent()).toEqual({});
  cleanup();

  render(card({ ...DESIGN, samples: [], sampledAt: null }));
  await userEvent.click(verdict("Good"));
  expect(sent()).toEqual({});
});

test("remixes the held voice from the review in one press: Gemini's changes, then Voice Remix with the page's settings", async () => {
  const revision = { heard: "too noble", prompt: "A colder voice.", preview_text: "y".repeat(120), archetype: "Queen", changes: "Make it colder. Keep the accent." };
  const fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: { ...DESIGN, id: "d2", version: 3 }, retired: [] }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Remix from review" }));
  const [remixUrl, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(remixUrl).toContain(`/api/voices/design/${DESIGN.id}/remix`);
  expect(JSON.parse(String(init.body))).toEqual({
    changes: "Make it colder. Keep the accent.",
    prompt: "A colder voice.",
    previewText: "y".repeat(120),
    settings: { promptStrength: 0.5, guidanceScale: null, loudness: null, seed: 9 },
    revisionHeard: "too noble",
    archetype: "Queen",
  });
});

test("designs and remixes from the review in one press, and names each preview for the call that made it", async () => {
  const revision = { heard: "too noble", prompt: "A colder voice.", preview_text: "y".repeat(120), archetype: "Queen", changes: "Make it colder." };
  const fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: { ...DESIGN, id: "d2", version: 3 }, retired: [] }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Generate and remix" }));
  const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toContain(`/api/voices/design/${DESIGN.id}/design-and-remix`);
  expect(JSON.parse(String(init.body))).toMatchObject({ changes: "Make it colder.", prompt: "A colder voice.", settings: context.remixSettings });
  cleanup();

  const previews = [0, 1, 2, 3].map((n) => ({ generatedVoiceId: `g${n}`, sha256: String(n).repeat(64), measures: null }));
  const reviews = [{ ...DESIGN.reviews[0], bestPreview: 3 }];
  render(card({ ...DESIGN, previews, reviews, analysis: { remix_of: 1, remix_from: 2, made_problem: "Voice Remix failed, so only Voice Design's previews were kept: down" } }));
  for (const name of ["Preview 1", "Preview 2", "Remix 1", "Remix 2"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(screen.getByText(/best: Remix 2/)).toBeTruthy();
  // The card that was pressed is replaced by the new version's, so the failure is kept on the version.
  expect(screen.getByText(/Voice Remix failed/)).toBeTruthy();
});

test("offers remix only to the voice's holder, while the voice is in their account", () => {
  render(card({ ...DESIGN, holderId: "u2" }));
  expect(screen.queryByRole("button", { name: "Remix from review" })).toBeNull();
  cleanup();
  render(card({ ...DESIGN, voiceDeletedAt: "2026-11-26T00:00:00Z" }));
  expect(screen.queryByRole("button", { name: "Remix from review" })).toBeNull();
});

test("shows a sampled version to players, and still voices it again while they hear it", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: { ...DESIGN, isPublic: true } }));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Show to players" }));
  const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(`/api/voices/design/${DESIGN.id}/show`);

  rerender(card({ ...DESIGN, isPublic: true }));
  expect(screen.getByText("Players hear this")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Voice the lines again" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/Players still hear the earlier lines/)).toBeNull();

  const earlier = { sha256: "e".repeat(64), text: "Old line.", npcName: "Grunt" };
  const round = { id: 3, createdAt: "2026-11-26T00:00:00Z", createdByName: "Ann", counts: { fits: 0, close: 0, off: 1, skip: 0 }, notes: [], samples: [earlier], linesChanged: true };
  rerender(card({ ...DESIGN, isPublic: true, playersHearOlderLines: true, showings: [round] }));
  expect(screen.getByText(/Players still hear the earlier lines/)).toBeTruthy();
  expect(screen.getByText("Lines players heard")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Line 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show again" }).classList.contains("bs-btn-primary")).toBe(true);
});

test("lists players' votes per showing, and hides a note as spam", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const showing = {
    id: 7,
    createdAt: "2026-11-26T00:00:00Z",
    createdByName: "Ann",
    counts: { fits: 2, close: 1, off: 1, skip: 0 },
    samples: null,
    linesChanged: false,
    notes: [{ voter: "a:x", who: null, verdict: "off" as const, note: "too old", at: "2026-11-26T00:00:00Z" }],
  };
  render(card({ ...DESIGN, isPublic: true, showings: [showing] }));

  const counts = within(screen.getByRole("list", { name: "Votes in this round" }));
  expect(counts.getAllByRole("listitem").map((item) => [item.getAttribute("data-verdict"), item.textContent])).toEqual([
    ["fits", "Fits 2"],
    ["close", "Close 1"],
    ["off", "Doesn't fit 1"],
    ["skip", "Skipped 0"],
  ]);
  expect(screen.getByText("too old")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Hide" }));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(`/api/voices/design/${DESIGN.id}/feedback`);
  expect(init.method).toBe("DELETE");
  expect(JSON.parse(String(init.body))).toEqual({ showingId: 7, voter: "a:x" });
});

test("takes the tag off the version players heard before, once another is shown", async () => {
  const before = { ...DESIGN, id: "d0", version: 1, isPublic: true };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ design: { ...DESIGN, isPublic: true } })));
  const updateDesign = vi.fn();
  render(
    <WorkbenchContext.Provider value={{ ...context, updateDesign }}>
      <VersionCard design={DESIGN} slot={{ name: DESIGN.slot, sampleChars: 0, reference: null, previewLines: {}, designs: [DESIGN, before] } as unknown as SlotView} newest />
    </WorkbenchContext.Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Show to players" }));
  expect(updateDesign).toHaveBeenCalledWith(expect.objectContaining({ id: "d0", isPublic: false }));
});

test("voices the same lines again in one press, and other lines from the button's menu", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));
  const sent = () => (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]);

  await userEvent.click(screen.getByRole("button", { name: "Voice the lines again" }));
  expect(sent()[0]).toContain("/api/voices/design/d1/samples");
  expect(JSON.parse(String(sent()[1].body))).toEqual({ lines: "same" });

  await userEvent.click(screen.getByRole("button", { name: "More ways to voice" }));
  await userEvent.click(await screen.findByRole("button", { name: "Voice other lines" }));
  expect(JSON.parse(String(sent()[1].body))).toEqual({ lines: "other" });
});

test("voices the lines with a direction typed before pressing, as long as it stays typed", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));
  const sent = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));

  await userEvent.type(screen.getByRole("textbox", { name: "Direction" }), "thick Scottish accent");
  await userEvent.click(screen.getByRole("button", { name: "Voice the lines again" }));
  expect(sent()).toEqual({ lines: "same", direction: "thick Scottish accent" });

  await userEvent.click(screen.getByRole("button", { name: "Voice the lines again" }));
  expect(sent()).toEqual({ lines: "same", direction: "thick Scottish accent" });
});

test("asks Gemini what differs between a line's new and live takes, and shows the answer under the line", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ difference: { summary: "The Scottish accent fades after the first words.", note: "Scottish accent fades after the first words", aspects: [{ aspect: "Accent", live: "broad Scots", new: "faint Scots" }] } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <WorkbenchContext.Provider value={{ ...context, live: { "q:1": "/live/1.mp3" } }}>
      <VersionCard design={DESIGN} slot={{ name: DESIGN.slot, sampleChars: 0, reference: null, previewLines: {} } as unknown as SlotView} newest />
    </WorkbenchContext.Provider>,
  );
  expect(screen.getAllByRole("button", { name: "What's different?" })).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: "What's different?" }));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/api/voices/design/d1/difference");
  expect(JSON.parse(String(init.body))).toEqual({ position: 1 });
  expect(await screen.findByText("The Scottish accent fades after the first words.")).toBeTruthy();
  expect(screen.getByText(/faint Scots/)).toBeTruthy();
  const answer = screen.getByText("The Scottish accent fades after the first words.");
  expect(screen.getByRole("button", { name: "What's different?" }).compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const note = screen.getByRole("textbox", { name: "Note" }) as HTMLInputElement;
  await userEvent.type(note, "too young");
  await userEvent.click(screen.getByRole("button", { name: "Add to review" }));
  expect(note.value).toBe("too young; Scottish accent fades after the first words");
});

test("goes back to the version before, after asking, when none of the previews is worth saving", async () => {
  const fetchMock = vi.fn(async () => Response.json({ deleted: "d1" }));
  vi.stubGlobal("fetch", fetchMock);
  const removeDesign = vi.fn();
  const unsaved = { ...DESIGN, voiceId: null, voiceName: null, holderId: null, chosenPreview: null, samples: [], sampledAt: null };
  const older = { ...DESIGN, id: "d0", version: 1 };
  render(
    <WorkbenchContext.Provider value={{ ...context, removeDesign }}>
      <VersionCard design={unsaved} slot={{ name: DESIGN.slot, sampleChars: 0, reference: null, previewLines: {}, designs: [unsaved, older] } as unknown as SlotView} newest />
    </WorkbenchContext.Provider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Back to v1" }));
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete v2" }));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/api/voices/design/d1");
  expect(init.method).toBe("DELETE");
  expect(removeDesign).toHaveBeenCalledWith(unsaved);
});

test("offers no way back once a preview is saved, or with no version before", () => {
  render(card(DESIGN));
  expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  cleanup();
  const unsaved = { ...DESIGN, voiceId: null, voiceName: null, holderId: null, chosenPreview: null, samples: [] };
  render(
    <WorkbenchContext.Provider value={context}>
      <VersionCard design={unsaved} slot={{ name: DESIGN.slot, sampleChars: 0, reference: null, previewLines: {}, designs: [unsaved] } as unknown as SlotView} newest />
    </WorkbenchContext.Provider>,
  );
  expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
});

test("sends the player notes ticked with the verdict, and lists them under it", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const showing = {
    id: 7,
    createdAt: "2026-11-26T00:00:00Z",
    createdByName: "Ann",
    counts: { fits: 0, close: 1, off: 1, skip: 0 },
    samples: null,
    linesChanged: false,
    notes: [
      { voter: "a:x", who: null, verdict: "off" as const, note: "too soft", at: "2026-11-26T00:00:00Z" },
      { voter: "u:y", who: "Bo", verdict: "close" as const, note: "slower", at: "2026-11-26T00:00:00Z" },
    ],
  };
  const { rerender } = render(card({ ...DESIGN, isPublic: true, showings: [showing] }));

  await userEvent.click(screen.getAllByRole("checkbox", { name: "Use for the next version" })[0]);
  await userEvent.click(verdict("Needs work"));
  expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).players).toEqual([{ showingId: 7, voter: "a:x" }]);

  const reviewed = { ...DESIGN.reviews[0], id: 2, players: [{ verdict: "off" as const, note: "too soft" }] };
  rerender(card({ ...DESIGN, isPublic: true, showings: [showing], reviews: [reviewed] }));
  expect(within(screen.getByRole("list", { name: "Verdicts" })).getByText("too soft")).toBeTruthy();
});

test("leaves out a ticked note that was hidden since", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const note = (voter: string, text: string) => ({ voter, who: null, verdict: "off" as const, note: text, at: "2026-11-26T00:00:00Z" });
  const showing = (notes: ReturnType<typeof note>[]) => ({ id: 7, createdAt: "2026-11-26T00:00:00Z", createdByName: "Ann", counts: { fits: 0, close: 0, off: 2, skip: 0 }, notes, samples: null, linesChanged: false });
  const { rerender } = render(card({ ...DESIGN, isPublic: true, showings: [showing([note("a:x", "spam"), note("a:y", "too soft")])] }));
  for (const box of screen.getAllByRole("checkbox", { name: "Use for the next version" })) await userEvent.click(box);

  rerender(card({ ...DESIGN, isPublic: true, showings: [showing([note("a:y", "too soft")])] }));
  await userEvent.click(verdict("Needs work"));
  expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).players).toEqual([{ showingId: 7, voter: "a:y" }]);
});

test("says which step failed and what the proxy answered when a call dies without the route's own error", async () => {
  const revision = { heard: "too noble", prompt: "A colder voice.", preview_text: "y".repeat(120), archetype: "Queen" };
  const gateway = "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>";
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/revise") ? Response.json({ revision }) : new Response(gateway, { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "text/html" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(card(DESIGN));

  await userEvent.click(screen.getByRole("button", { name: "Generate from review" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Voice Design");
  expect(alert.textContent).toContain("502 Bad Gateway");
  expect(alert.textContent).toContain("POST /api/voices/design");
  expect(alert.textContent).toContain("nginx");
});
