// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
  playing: null,
  play: () => {},
  drafts: {},
  setDraft: () => {},
  updateDesign: () => {},
  updateAnalysis: () => {},
};

const card = (design: Design) => (
  <WorkbenchContext.Provider value={context}>
    <VersionCard design={design} slot={{ name: design.slot, sampleChars: 0 } as SlotView} newest />
  </WorkbenchContext.Provider>
);

test("drops the marks on lines that a re-sample replaced, and the preview marks nobody can see", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(card(DESIGN));
  rerender(card({ ...DESIGN, samples: [sample(0, "d"), sample(1, "e")] }));

  await userEvent.click(screen.getByRole("radio", { name: "Good" }));
  await userEvent.click(screen.getByRole("button", { name: "Add verdict" }));
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body.clips).toEqual({});
});

test("leaves the best preview out of a verdict until the reviewer picks one, though Save starts on the recommended", async () => {
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
  expect(screen.getByRole("button", { name: "Save preview 2 as a voice" })).toBeTruthy();

  await userEvent.click(screen.getByRole("radio", { name: "Needs work" }));
  await userEvent.click(screen.getByRole("button", { name: "Save verdict" }));
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body.bestPreview).toBeNull();
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
  expect(screen.getByRole("button", { name: /^Save preview \d as a voice$/ })).toBeTruthy();
});

test("clears the form of a verdict that was removed", () => {
  const { rerender } = render(card(DESIGN));
  expect(screen.getByRole("radio", { name: "Needs work" }).getAttribute("aria-checked")).toBe("true");
  rerender(card({ ...DESIGN, reviews: [] }));
  expect(screen.getByRole("radio", { name: "Needs work" }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("button", { name: "Save verdict" })).toBeTruthy();
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
