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
  reviews: [{ id: 1, status: "needs-work", note: "", bestPreview: 0, clips: { "sample:2": "off", "preview:0": "good" }, createdBy: "u1", createdByName: "Ann", createdAt: "2026-11-26T00:00:00Z" }],
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
  remixSettings: { promptStrength: 0.5, guidanceScale: null, loudness: null, seed: 9 },
  setRemixSettings: () => {},
};

/** A verdict button: the sample lines' marks are named Good too. */
const verdict = (name: string) => within(screen.getByRole("textbox", { name: "Note" }).closest(".vd-review-form") as HTMLElement).getByRole("button", { name });

const card = (design: Design) => (
  <WorkbenchContext.Provider value={context}>
    <VersionCard design={design} slot={{ name: design.slot, sampleChars: 0, reference: null, previewLines: {} } as unknown as SlotView} newest />
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
  const fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: { ...DESIGN, id: "d2", version: 3 } }));
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
  const fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: { ...DESIGN, id: "d2", version: 3 } }));
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

test("offers remix only to the voice's holder, while the voice is in their account", () => {
  render(card({ ...DESIGN, holderId: "u2" }));
  expect(screen.queryByRole("button", { name: "Remix from review" })).toBeNull();
  cleanup();
  render(card({ ...DESIGN, voiceDeletedAt: "2026-11-26T00:00:00Z" }));
  expect(screen.queryByRole("button", { name: "Remix from review" })).toBeNull();
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
