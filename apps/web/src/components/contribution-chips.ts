import type { ChipOption } from "@/components/FilterChip";
import { CLIENT_FAMILIES, CLIENT_FAMILY_LABELS } from "@/lib/contributions/client";

/** "any" is the idle state, so it is not an option. */
export const SEARCH_IN_OPTIONS: ChipOption[] = [
  { value: "npc", label: "NPC only" },
  { value: "quest", label: "Quest only" },
  { value: "text", label: "Text only" },
];

export const CLIENT_CHIP_OPTIONS: ChipOption[] = CLIENT_FAMILIES.map((option) => ({
  value: option,
  label: CLIENT_FAMILY_LABELS[option],
}));
