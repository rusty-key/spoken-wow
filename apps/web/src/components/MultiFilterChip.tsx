"use client";

import { ChipClear, type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A filter dropdown that takes several values, wearing the same two states as FilterChip.
 *
 * A popover of checkboxes rather than FilterChip's select, because Radix's select holds one
 * value. Ticking leaves the popover open, so picking three values is three clicks, not six.
 * Nothing ticked means not filtering, so `onChange` gets undefined rather than an empty list.
 */
export default function MultiFilterChip({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: readonly string[] | undefined;
  options: readonly ChipOption[];
  onChange: (values: string[] | undefined) => void;
}) {
  const chosen = values ?? [];
  const active = chosen.length > 0;
  const shown = chosen.map((value) => options.find((option) => option.value === value)?.label ?? value).join(", ");

  function toggle(value: string, on: boolean) {
    // In option order, so the URL and the chip read the same whichever box was ticked first.
    const next = options.map((option) => option.value).filter((v) => (v === value ? on : chosen.includes(v)));
    onChange(next.length ? next : undefined);
  }

  return (
    <div className="inline-flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={active ? "default" : "outline"}
            aria-label={label}
            className={cn(
              "h-8 w-fit gap-1 px-2.5 text-sm font-medium",
              active ? "rounded-r-none border-primary pr-1.5" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="line-clamp-1">{active ? `${label}: ${shown}` : label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto min-w-40 p-1" align="start">
          {options.map((option) => {
            const id = `${label}-${option.value}`;
            return (
              <label
                key={option.value}
                htmlFor={id}
                className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
              >
                <Checkbox
                  id={id}
                  checked={chosen.includes(option.value)}
                  onCheckedChange={(on) => toggle(option.value, on === true)}
                />
                {option.label}
              </label>
            );
          })}
        </PopoverContent>
      </Popover>

      {active && <ChipClear label={label} onClear={() => onChange(undefined)} />}
    </div>
  );
}
