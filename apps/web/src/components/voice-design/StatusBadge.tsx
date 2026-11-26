"use client";

import { useUiText } from "@/components/UiTextProvider";
import type { Doneness } from "@/lib/voice-design/groups";

export default function StatusBadge({ doneness }: { doneness: Doneness }) {
  const t = useUiText().voiceDesign;
  const label: Record<Doneness, string> = {
    none: t.statusNone,
    pending: t.statusPending,
    "needs-work": t.statusNeedsWork,
    good: t.statusGood,
  };
  return (
    <span className="vd-badge" data-status={doneness}>
      {label[doneness]}
    </span>
  );
}
