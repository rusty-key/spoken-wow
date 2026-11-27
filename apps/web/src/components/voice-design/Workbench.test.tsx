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
    reviews: review ? [{ id: version, status: review, note, bestPreview: null, clips: {}, players: [], createdBy: null, createdByName: "Ann", createdAt: "2026-11-26T00:00:00Z" }] : [],
    isPublic: false,
    playersHearOlderLines: false,
    showings: [],
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
  previewLines: {},
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

const workbench = (url: { initialFilter?: string; initialQuery?: string } = {}) =>
  render(
    <LangProvider lang="enUS">
      <Workbench groups={groups} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" {...url} />
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

test("searches prompts and the notes of the versions on the page", async () => {
  workbench();
  await userEvent.type(screen.getByRole("searchbox"), "too noble");
  expect(slotsShown()).toEqual(["orc-male-shady"]);
});

test("keeps the filter and the search in the URL", async () => {
  window.history.replaceState(null, "", "/voices/design");
  workbench();
  const chips = within(screen.getByRole("group", { name: "Show slots" }));
  await userEvent.click(chips.getByRole("button", { name: /^Needs work/ }));
  await userEvent.type(screen.getByRole("searchbox"), "noble");
  expect(new URLSearchParams(window.location.search).get("status")).toBe("needs-work");
  expect(new URLSearchParams(window.location.search).get("q")).toBe("noble");

  await userEvent.click(chips.getByRole("button", { name: /^All/ }));
  await userEvent.clear(screen.getByRole("searchbox"));
  expect(window.location.search).toBe("");
});

test("starts from the filter and the search in the URL", () => {
  workbench({ initialFilter: "needs-work", initialQuery: "noble" });
  expect(slotsShown()).toEqual(["orc-male-shady"]);
  expect(screen.getByRole("searchbox")).toHaveProperty("value", "noble");
  cleanup();
  workbench({ initialFilter: "bogus" });
  expect(slotsShown()).toHaveLength(3);
});

test("shows only a slot's newest version: the next one replaces it", () => {
  workbench();
  const shady = screen.getByRole("article", { name: "orc-male-shady" });
  expect(within(shady).getByText("Prompt of orc-male-shady v2")).toBeTruthy();
  expect(within(shady).queryByText("Prompt of orc-male-shady v1")).toBeNull();
});

test("keeps the version players hear on the page until a newer one is shown", () => {
  const heard = { ...design("orc-male-shady", 1, null), isPublic: true };
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [design("orc-male-shady", 2, null), heard])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  const shady = screen.getByRole("article", { name: "orc-male-shady" });
  expect(within(shady).getByText("Prompt of orc-male-shady v2")).toBeTruthy();
  expect(within(shady).getByText("Prompt of orc-male-shady v1")).toBeTruthy();
});

test("searches only the versions on the page", async () => {
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [design("orc-male-shady", 2, null), design("orc-male-shady", 1, null)])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  await userEvent.type(screen.getByRole("searchbox"), "orc-male-shady v1");
  expect(screen.queryByRole("article", { name: "orc-male-shady" })).toBeNull();
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
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/revise") ? { revision } : { design: v3, retired: [] })));
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
      return Response.json({ design: { ...design(slotName, slotName === "orc-male-shady" ? 3 : 2, null), id: `${slotName}-new` }, retired: [] });
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

test("a clip's button pauses it while it plays and resumes it after", async () => {
  // jsdom has no media playback or ResizeObserver, which the player's sliders measure with.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    paused.set(this, false);
    this.dispatchEvent(new Event("play"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
    this.dispatchEvent(new Event("pause"));
  });
  const voiced = { ...design("orc-male-shady", 1, null), previews: [{ generatedVoiceId: "g", sha256: "a".repeat(64), measures: null }] };
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [voiced])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  const preview = screen.getByRole("button", { name: "Preview 1" });

  await userEvent.click(preview);
  await vi.waitFor(() => expect(preview.getAttribute("aria-pressed")).toBe("true"));
  await userEvent.click(preview);
  expect(preview.getAttribute("aria-pressed")).toBe("false");
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  await userEvent.click(preview);
  expect(preview.getAttribute("aria-pressed")).toBe("true");
  vi.restoreAllMocks();
});

test("plays the game's clip and the corpus line a preview text came from beside the previews", () => {
  const picked = design("orc-male-shady", 1, null);
  const line = { lineId: "q:7:accept", npcName: "Grukk", src: "/api/quests/audio/x.mp3" };
  render(
    <LangProvider lang="enUS">
      <Workbench
        groups={[{ group: "orc-male", analysis: null, slots: [{ ...slot("orc-male-shady", [picked]), reference: "/ref.mp3", previewLines: { [picked.previewText]: line } }] }]}
        live={{}}
        viewer={{ id: "u1", designs: true, admin: false }}
        keys={{ elevenlabs: true, gemini: true }}
        rate={0.5}
        model="eleven_v4"
      />
    </LangProvider>,
  );
  const card = within(screen.getByRole("region", { name: "orc-male-shady v1" }));
  expect(card.getByRole("button", { name: "Reference clip" })).toBeTruthy();
  expect(card.getByRole("button", { name: "Live" })).toBeTruthy();
  expect(card.getByText("Grukk")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Reference clip" })).toHaveLength(1);
});

test("lines voiced for the first time show their live takes without a reload", async () => {
  const saved = { ...design("orc-male-shady", 1, null), voiceId: "v", voiceName: "n", holderId: "u1" };
  const line = { position: 0, sha256: "a".repeat(64), lineId: "q:9:accept", text: "Lok'tar", npcName: "Grukk", characters: 7, credits: 4 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ design: { ...saved, samples: [line], sampledAt: "2026-11-26T01:00:00Z" }, live: { "q:9:accept": "/api/quests/audio/q9.mp3" } })));
  render(
    <LangProvider lang="enUS">
      <Workbench groups={[{ group: "orc-male", analysis: null, slots: [slot("orc-male-shady", [saved])] }]} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Voice 3 lines" }));
  expect(await screen.findByText("Lok'tar")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Live" })).toBeTruthy();
});

test("Delete older voices asks first, then deletes every older version's voice the viewer holds and says which failed", async () => {
  const held = (d: Design, holderId = "u1"): Design => ({ ...d, voiceId: `voice-${d.id}`, voiceName: d.id, holderId, holderName: "Ann" });
  const slots: GroupView[] = [
    {
      group: "orc-male",
      analysis: null,
      slots: [
        slot("orc-male-shady", [held(design("orc-male-shady", 3, null)), held(design("orc-male-shady", 2, "needs-work")), held(design("orc-male-shady", 1, "needs-work"))]),
        slot("orc-male-guard", [held(design("orc-male-guard", 2, null)), held(design("orc-male-guard", 1, "good"), "u2")]),
      ],
    },
  ];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).toBe("DELETE");
    if (url.includes("orc-male-shady-1")) return Response.json({ error: "the voice is now named \"orc-male-shady\"" }, { status: 400 });
    return Response.json({ design: { ...held(design("orc-male-shady", 2, "needs-work")), voiceDeletedAt: "2026-11-26T01:00:00Z" } });
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <LangProvider lang="enUS">
      <Workbench groups={slots} live={{}} viewer={{ id: "u1", designs: true, admin: false }} keys={{ elevenlabs: true, gemini: true }} rate={0.5} model="eleven_v4" />
    </LangProvider>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Delete older voices · 2" }));
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("orc-male-shady v1: the voice is now named"));
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/voices/design/orc-male-shady-2/voice", "/api/voices/design/orc-male-shady-1/voice"]);
  expect(screen.getByRole("button", { name: "Delete older voices · 1" })).toBeTruthy();
});

test("narrows to the slots players say mostly don't fit, and keeps it in the URL", async () => {
  const voted = (name: string, counts: Design["showings"][number]["counts"]): Design => ({
    ...design(name, 1, null),
    isPublic: true,
    showings: [{ id: 1, createdAt: "2026-11-26T00:00:00Z", createdByName: "Ann", counts, notes: [], samples: null }],
  });
  render(
    <LangProvider lang="enUS">
      <Workbench
        groups={[
          {
            group: "orc-male",
            analysis: null,
            slots: [
              slot("orc-male-guard", [voted("orc-male-guard", { fits: 4, close: 0, off: 1, skip: 0 })]),
              slot("orc-male-shady", [voted("orc-male-shady", { fits: 0, close: 1, off: 3, skip: 2 })]),
              slot("orc-male-standard", []),
            ],
          },
        ]}
        live={{}}
        viewer={{ id: "u1", designs: true, admin: false }}
        keys={{ elevenlabs: true, gemini: true }}
        rate={0.5}
        model="eleven_v4"
      />
    </LangProvider>,
  );
  const players = within(screen.getByRole("group", { name: "Players say" }));
  await userEvent.click(players.getByRole("button", { name: /Mostly doesn't fit/ }));
  expect(slotsShown()).toEqual(["orc-male-shady"]);
  expect(new URL(window.location.href).searchParams.get("players")).toBe("off");
  await userEvent.click(players.getByRole("button", { name: /Mostly fits/ }));
  expect(slotsShown()).toEqual(["orc-male-guard"]);
});
