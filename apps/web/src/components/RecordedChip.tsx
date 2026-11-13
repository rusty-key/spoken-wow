"use client";

import FilterChip from "@/components/FilterChip";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";

/**
 * Whether a voice actor has recorded the line, for the three search bars. Drawn only when
 * the search said the viewer records here: for anybody else the route drops the filter.
 */
export default function RecordedChip({
  value,
  onChange,
}: {
  value: Recorded | undefined;
  onChange: (value: Recorded | undefined) => void;
}) {
  return (
    <FilterChip
      label="voice actor"
      value={value}
      options={RECORDED_OPTIONS}
      onChange={(next) => onChange(next as Recorded | undefined)}
    />
  );
}
