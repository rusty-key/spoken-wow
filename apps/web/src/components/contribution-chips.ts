import type { ChipOption } from "@/components/FilterChip";
import { STAGES, type Stage } from "@/lib/contributions/query";

export const STAGE_LABELS: Record<Stage, string> = {
  accept: "Accept",
  progress: "Progress",
  complete: "Complete",
  gossip: "Gossip",
};

/** Every stage the Stage dropdown can offer; a view without gossip filters it out. */
export const STAGE_CHIP_OPTIONS: ChipOption[] = STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] }));

/** "any" is the idle state, so it is not an option. */
export const SEARCH_IN_OPTIONS: ChipOption[] = [
  { value: "npc", label: "NPC only" },
  { value: "quest", label: "Quest only" },
  { value: "text", label: "Text only" },
];
