"use client";

import { Input } from "@/components/ui/input";
import { levelFromParam } from "@/lib/line-fields";

/**
 * Commits on blur, because committing per keystroke would search for level 1 on the way to typing
 * 10. The key remounts this uncontrolled input, so "clear all" empties it.
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
      onBlur={(event) => {
        const next = levelFromParam(event.currentTarget.value);
        if (next !== value) onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
