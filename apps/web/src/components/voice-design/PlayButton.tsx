"use client";

import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { cn } from "@/lib/utils";

import { useWorkbench, type Playing } from "./context";

/** Pressed again while its clip plays, pauses it. `live` marks a clip from outside the design. */
export default function PlayButton({ clip, live, title, children }: { clip: Playing; live?: boolean; title?: string; children: ReactNode }) {
  const { play, isPlaying } = useWorkbench();
  const on = isPlaying(clip.src);
  const Icon = on ? Pause : Play;
  return (
    <button type="button" className={cn("vd-play", live && "vd-play-live", on && "vd-play-on")} title={title} aria-pressed={on} onClick={() => play(clip)}>
      <Icon size={13} aria-hidden="true" />
      {children}
    </button>
  );
}

export function ReferenceClip({ slot }: { slot: { name: string; reference: string | null } }) {
  const t = useUiText().voiceDesign;
  if (!slot.reference) {
    return (
      <span className="vd-muted" title={t.gameClipNote}>
        {t.noGameReference}
      </span>
    );
  }
  return (
    <PlayButton clip={{ src: slot.reference, title: slot.name, meta: t.gameReference, subtitle: t.gameClipNote }} live title={t.gameClipNote}>
      {t.gameReference}
    </PlayButton>
  );
}
