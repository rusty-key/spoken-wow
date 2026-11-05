"use client";

import { Input } from "@/components/ui/input";
import { levelFromParam } from "@/lib/line-fields";

/**
 * One end of the level range. It commits on blur or Enter, because committing per keystroke would
 * search for level 1 on the way to typing 10. The key remounts it when the URL changes, so "clear
 * all" empties it.
 */
export default function LevelBound({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const commit = (input: HTMLInputElement) => {
    const next = levelFromParam(input.value);
    if (next !== value) onChange(next);
  };

  return (
    <Input
      key={value ?? ""}
      type="number"
      min={0}
      max={999}
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      className="h-8 w-16 px-2 text-sm"
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget);
      }}
    />
  );
}
