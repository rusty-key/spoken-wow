"use client";

import { XIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The value a dropdown carries when it is not filtering.
 *
 * Radix rejects an item with an empty value - it reserves that for "nothing selected" - so
 * "not filtering" needs a name of its own, mapped back to undefined on the way out.
 */
export const ANY = "any";

export type ChipOption = { value: string; label: string };

/**
 * One filter dropdown, in one of two states you can tell apart across the room.
 *
 * Idle it is an outlined button carrying only the field name, because "race: any" is six
 * characters spent saying nothing. Set it fills with the accent colour, shows the value, and
 * grows a reset next to it - so the answer to "what is narrowing this list?" is the set of
 * filled chips, readable without opening anything.
 *
 * The reset is a sibling of the trigger rather than a child of it: a button inside a button
 * is invalid HTML, and Radix's trigger is a real <button>. They are joined visually by
 * flattening the edges that meet, which is why the corner rounding is split across the two.
 */
export default function FilterChip({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string | undefined;
  options: readonly ChipOption[];
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const active = value !== undefined;
  const selected = options.find((option) => option.value === value);

  // A value with no option is still a filter in force - the review queue deep-links an exact
  // issue category that is not in the list - so it shows as itself rather than as its absence.
  const shown = selected?.label ?? value;

  return (
    <div className={cn("inline-flex items-center", className)}>
      <Select
        value={value ?? ANY}
        onValueChange={(next) => onChange(next === ANY ? undefined : next)}
      >
        <SelectTrigger
          aria-label={label}
          className={cn(
            "w-fit gap-1 font-medium transition-colors",
            active
              ? "rounded-r-none border-primary bg-primary pr-1.5 text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 [&_svg]:text-primary-foreground/70"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {/* Through SelectValue rather than a plain span, even though the text is our own.
              Radix registers this node as the alignment anchor, and its item-aligned
              positioning - what SelectContent defaults to here - is guarded on that node
              existing: without it the dropdown mounts unpositioned and nothing appears.
              Passing children also suppresses the portal that would otherwise replace this
              text with the raw option label. */}
          <SelectValue className="line-clamp-1">
            {active ? `${label}: ${shown}` : label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{label}: any</SelectItem>
          {/* A deep-linked value absent from the options, kept selectable so reopening the
              dropdown does not silently drop the filter that is in force. */}
          {active && !selected && <SelectItem value={value}>{value}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active && <ChipClear label={label} onClear={() => onChange(undefined)} />}
    </div>
  );
}

/** The X joined to an active chip's right edge; MultiFilterChip wears it too. */
export function ChipClear({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${label} filter`}
      onClick={onClear}
      className="border-primary bg-primary text-primary-foreground/70 hover:text-primary-foreground focus-visible:ring-ring/50 flex h-8 items-center rounded-r-lg border border-l-0 pr-2 pl-1 transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3"
    >
      <XIcon className="size-3.5" />
    </button>
  );
}
