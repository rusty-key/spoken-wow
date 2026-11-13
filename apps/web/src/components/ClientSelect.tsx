"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CLIENT_BIN_LABELS,
  CLIENT_FAMILIES,
  CLIENT_FAMILY_LABELS,
  type ClientFilter,
} from "@/lib/contributions/client";

const LABELS: Record<ClientFilter, string> = {
  ...CLIENT_BIN_LABELS,
  ...CLIENT_FAMILY_LABELS,
  all: "All clients",
};

const OPTIONS: ClientFilter[] = ["focus", "low-effort", ...CLIENT_FAMILIES, "all"];

/**
 * The client filter, as quiet text rather than a FilterChip: it is on by default, and a filled
 * chip on every visit would read as something the moderator had narrowed.
 */
export default function ClientSelect({
  value,
  onChange,
}: {
  value: ClientFilter;
  onChange: (value: ClientFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ClientFilter)}>
      <SelectTrigger
        aria-label="client"
        className="text-muted-foreground hover:text-foreground ml-auto h-auto gap-0.5 border-0 px-0 py-0 text-xs dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3"
      >
        {/* Through SelectValue for FilterChip's reason: Radix anchors the dropdown on it. */}
        <SelectValue>
          <span className="underline decoration-dotted underline-offset-4">{LABELS[value]}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
