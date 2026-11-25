"use client";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiText } from "@/components/UiTextProvider";
import { cn } from "@/lib/utils";
import { fill } from "@/lib/site-text/format";

/** "YYYY-MM-DD" in local time, which is what the filter reads and what a calendar means. */
function toDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Parsed as local midnight rather than through `new Date(day)`, which reads a bare date as
 * UTC and lands on the previous day for anyone west of Greenwich.
 */
function fromDay(day: string | undefined): Date | undefined {
  if (!day) return undefined;
  const at = new Date(`${day}T00:00:00`);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/**
 * One end of the generated-on range, wearing the same two states as FilterChip.
 *
 * A calendar rather than a text field because the useful question is "since roughly when?",
 * which is a thing you point at rather than type. Kept as a separate component from
 * FilterChip: they look alike on purpose, but a popover holding a calendar and a select over
 * a closed list share no behaviour worth abstracting over.
 */
export default function DateChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const words = useUiText().common;
  const active = value !== undefined;
  const selected = fromDay(value);

  return (
    <div className="inline-flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={active ? "default" : "outline"}
            aria-label={label}
            className={cn(
              "h-8 w-fit gap-1 px-2.5 text-sm font-medium",
              active
                ? "rounded-r-none border-primary pr-1.5"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? `${label}: ${value}` : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => onChange(date ? toDay(date) : undefined)}
          />
        </PopoverContent>
      </Popover>

      {active && (
        <button
          type="button"
          aria-label={fill(words.clearFilter, { label })}
          onClick={() => onChange(undefined)}
          className="border-primary bg-primary text-primary-foreground/70 hover:bg-primary/90 hover:text-primary-foreground focus-visible:ring-ring/50 flex h-8 items-center rounded-r-lg border border-l-0 pr-2 pl-1 transition-colors outline-none focus-visible:ring-3"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
