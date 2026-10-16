import { expect, it, vi } from "vitest";
import { COMBAT_VOICES } from "@/lib/combat/catalogue";

vi.mock("@/lib/quests/catalogue", () => ({ corpus: async () => ({ lines: [] }) }));
vi.mock("./roster-store", () => ({ loadRoster: async () => ({ voiceNames: ["nightelf-female-standard"] }) }));

import { isVoiceSlot, voiceSlots } from "./slots";

it("offers all player voices without needing NPC roster assignments", async () => {
  const slots = await voiceSlots();
  expect(slots).toHaveLength(17);
  for (const voice of COMBAT_VOICES) {
    expect(await isVoiceSlot(voice.id)).toBe(true);
    expect(slots.find((slot) => slot.name === voice.id)).toEqual({
      name: voice.id, lineCount: voice.lines.length, npcCount: 0,
    });
  }
  expect(await isVoiceSlot("nightelf-female-standard")).toBe(true);
  expect(await isVoiceSlot("dwarf-female-player/../bad")).toBe(false);
});
