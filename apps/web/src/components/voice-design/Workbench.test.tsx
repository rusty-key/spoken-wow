// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { Design } from "@/lib/voice-design/types";

import Workbench, { type GroupView, type SlotView } from "./Workbench";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/voices/design",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

function design(slot: string, version: number, review: Design["reviews"][number]["status"] | null, note = ""): Design {
  return {
    id: `${slot}-${version}`,
    lang: "enUS",
    slot,
    version,
    prompt: `Prompt of ${slot} v${version}`,
    previewText: "x".repeat(120),
    previews: [],
    chosenPreview: null,
    voiceId: null,
    voiceName: null,
    holderId: null,
    holderName: null,
    voiceDeletedAt: null,
    sampleModel: null,
    analysisId: null,
    note: null,
    analysis: null,
    samples: [],
    sampledAt: null,
    reviews: review ? [{ id: version, status: review, note, bestPreview: null, clips: {}, createdBy: null, createdByName: "Ann", createdAt: "2026-11-26T00:00:00Z" }] : [],
    createdBy: null,
    createdByName: "Ann",
    createdAt: "2026-11-26T00:00:00Z",
  };
}

const slot = (name: string, designs: Design[]): SlotView => ({
  name,
  group: name.split("-").slice(0, 2).join("-"),
  lineCount: 10,
  npcs: ["Grunt"],
  reference: null,
  candidates: [],
  sampleChars: 300,
  designs,
});

const groups: GroupView[] = [
  {
    group: "orc-male",
    analysis: null,
    slots: [
      slot("orc-male-guard", [design("orc-male-guard", 1, "good")]),
      slot("orc-male-shady", [design("orc-male-shady", 2, "needs-work", "too noble"), design("orc-male-shady", 1, "needs-work", "sounds female")]),
      slot("orc-male-standard", []),
    ],
  },
];

const workbench = () =>
  render(
    <LangProvider lang="enUS">
      <Workbench groups={groups} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );

const slotsShown = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);

test("filters by how far each slot's newest version has got, with counts", async () => {
  workbench();
  const chips = within(screen.getByRole("group", { name: "Show slots" }));
  expect(chips.getByRole("button", { name: /^Good\s*1$/ })).toBeTruthy();
  expect(chips.getByRole("button", { name: /^No design\s*1$/ })).toBeTruthy();

  await userEvent.click(chips.getByRole("button", { name: /^Good/ }));
  expect(slotsShown()).toEqual(["orc-male-guard"]);
  await userEvent.click(chips.getByRole("button", { name: /^No design/ }));
  expect(slotsShown()).toEqual(["orc-male-standard"]);
});

test("searches prompts and every version's notes", async () => {
  workbench();
  await userEvent.type(screen.getByRole("searchbox"), "sounds female");
  expect(slotsShown()).toEqual(["orc-male-shady"]);
});

test("shows the newest version open and folds the older ones", () => {
  workbench();
  const shady = screen.getByRole("article", { name: "orc-male-shady" });
  const older = within(shady).getByText(/Older versions · 1/).closest("details")!;
  expect(older.open).toBe(false);
  expect(within(older).getByText("Prompt of orc-male-shady v1")).toBeTruthy();
  const newest = within(shady).getByText("Prompt of orc-male-shady v2");
  expect(older.contains(newest)).toBe(false);
});

test("Revise puts Gemini's draft into a form that was already open", async () => {
  const sampled = { ...design("orc-male-shady", 2, "needs-work", "too noble"), samples: [{ position: 0, sha256: "a".repeat(64), lineId: "q:1", text: "t", npcName: null, characters: 1, credits: 1 }] };
  const revisable: GroupView[] = [{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [sampled])] }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ revision: { heard: "h", prompt: "Gemini's new prompt", preview_text: "y".repeat(120), archetype: "a" } })));
  Element.prototype.scrollIntoView = () => {};
  render(
    <LangProvider lang="enUS">
      <Workbench groups={revisable} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  await userEvent.click(await screen.findByRole("button", { name: "New version from v2" }));
  expect(screen.getByDisplayValue(/^Prompt of orc-male-shady v2/)).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  await userEvent.click(await screen.findByRole("button", { name: "Revise from review" }));
  expect(await screen.findByDisplayValue("Gemini's new prompt")).toBeTruthy();
});

test("Generate opens the new version with an empty note and closes a draft left from the old one", async () => {
  const line = { position: 0, sha256: "a".repeat(64), lineId: "q:1", text: "t", npcName: null, characters: 1, credits: 1 };
  const v2 = { ...design("orc-male-shady", 2, "needs-work", "too noble"), samples: [line] };
  const v3 = { ...design("orc-male-shady", 3, null), id: "orc-male-shady-3" };
  const revision = { heard: "h", prompt: "Gemini's new prompt", preview_text: "y".repeat(120), archetype: "a" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: v3 })));
  Element.prototype.scrollIntoView = () => {};
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [v2])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  await userEvent.click(await screen.findByRole("button", { name: "Revise from review" }));
  expect(await screen.findByDisplayValue("Gemini's new prompt")).toBeTruthy();
  const note = (v: number) => within(screen.getByRole("region", { name: `orc-male-shady v${v}` })).getByRole("textbox", { name: "Note" }) as HTMLInputElement;
  await userEvent.type(note(2), "half-typed");

  await userEvent.click(screen.getByRole("button", { name: "Generate from review" }));
  expect(await screen.findByText("Prompt of orc-male-shady v3")).toBeTruthy();
  expect(note(3).value).toBe("");
  expect(screen.queryByDisplayValue("Gemini's new prompt")).toBeNull();
});

test("Generate all asks first with the cost, then makes each needs-work slot's next version in turn", async () => {
  const line = { position: 0, sha256: "a".repeat(64), lineId: "q:1", text: "t", npcName: null, characters: 1, credits: 1 };
  const shady = { ...design("orc-male-shady", 2, "needs-work", "too noble"), samples: [line] };
  const grunt = { ...design("orc-male-grunt", 1, "needs-work", "too soft"), samples: [line] };
  const revision = { heard: "h", prompt: "p", preview_text: "y".repeat(120), archetype: "a" };
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/revise")) {
        calls.push(`revise ${url.split("/").at(-2)}`);
        return Response.json({ revision });
      }
      const slotName = JSON.parse(String(init.body)).slot as string;
      calls.push(`design ${slotName}`);
      return Response.json({ design: { ...design(slotName, slotName === "orc-male-shady" ? 3 : 2, null), id: `${slotName}-new` } });
    }),
  );
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [shady]), slot("orc-male-grunt", [grunt])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  await userEvent.click(within(screen.getByRole("group", { name: "Show slots" })).getByRole("button", { name: /^Needs work/ }));
  await userEvent.click(screen.getByRole("button", { name: "Generate all from reviews · 2" }));
  expect(calls).toEqual([]);
  expect(screen.getByText("Make 2 new versions for about 720 ElevenLabs credits?")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Generate" }));
  await vi.waitFor(() => expect(calls).toHaveLength(4));
  expect(calls).toEqual(["revise orc-male-shady-2", "design orc-male-shady", "revise orc-male-grunt-1", "design orc-male-grunt"]);
});
