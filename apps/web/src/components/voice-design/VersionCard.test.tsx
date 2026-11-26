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
    <VersionCard design={design} slot={{ name: design.slot, sampleChars: 0 } as SlotView} />
  </WorkbenchContext.Provider>
);

test("drops the marks on lines that a re-sample replaced, and keeps the previews'", async () => {
  const fetchMock = vi.fn(async () => Response.json({ design: DESIGN }));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(card(DESIGN));
  rerender(card({ ...DESIGN, samples: [sample(0, "d"), sample(1, "e")] }));

  await userEvent.click(screen.getByRole("radio", { name: "Good" }));
  await userEvent.click(screen.getByRole("button", { name: "Save verdict" }));
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body.clips).toEqual({ "preview:0": "good" });
});
