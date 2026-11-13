"use client";

/**
 * A select whose list can be searched: the type, gender, flavor and voice pickers on /npcs. It
 * can be led by a "New" entry, which either acts at once or swaps the list for a form making the
 * missing option, in the same popover, so a refusal or a question about it shows where it was asked.
 */
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { LiteButton, ROW_BUTTON } from "@/components/LiteControls";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type NewOption = {
  label: string;
  /** Acts at once, closing the list. */
  onSelect?: () => void;
  /** A form in the list's place; `close` shuts the popover once it is done. */
  form?: (close: () => void) => ReactNode;
};

export default function SearchSelect({
  value,
  options,
  placeholder,
  label,
  clear,
  create,
  disabled,
  className,
  onChange,
}: {
  value: string | null;
  options: readonly string[];
  /** What the trigger says while nothing is picked. */
  placeholder: string;
  /** What the trigger says instead of the value. */
  label?: ReactNode;
  /** An entry that picks nothing, by this name. */
  clear?: string;
  create?: NewOption;
  disabled?: boolean;
  /** The trigger's width. */
  className?: string;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setMaking(false);
  };
  const pick = (next: string | null) => {
    toggle(false);
    if (next !== value) onChange(next);
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <LiteButton
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(ROW_BUTTON, "justify-between font-normal", className)}
        >
          <span className={cn("truncate", value === null && "text-muted-foreground")}>
            {label ?? value ?? placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-60", making ? "p-2" : "p-0")}>
        {making && create?.form ? (
          create.form(() => toggle(false))
        ) : (
          <Command>
            <CommandInput placeholder="Search" className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty className="py-3 text-center text-xs">Nothing matches.</CommandEmpty>
              {create ? (
                <CommandGroup>
                  {/* Kept through any search: one that finds nothing is when it is wanted. */}
                  <CommandItem
                    forceMount
                    value={`new ${create.label}`}
                    className="text-xs"
                    onSelect={() => {
                      if (create.form) setMaking(true);
                      else {
                        toggle(false);
                        create.onSelect?.();
                      }
                    }}
                  >
                    <Plus className="size-3.5" />
                    {create.label}
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandGroup>
                {clear ? (
                  <CommandItem value={clear} className="text-muted-foreground text-xs" onSelect={() => pick(null)}>
                    <Check className={cn("size-3.5", value === null ? "opacity-100" : "opacity-0")} />
                    {clear}
                  </CommandItem>
                ) : null}
                {options.map((option) => (
                  <CommandItem key={option} value={option} className="text-xs" onSelect={() => pick(option)}>
                    <Check className={cn("size-3.5", option === value ? "opacity-100" : "opacity-0")} />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
