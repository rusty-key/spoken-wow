"use client";

import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useWorkbench, type Playing } from "./context";

/** Plays its clip through the page's one player; pressed again while it plays, pauses it. */
export default function PlayButton({ clip, className, title, children }: { clip: Playing; className?: string; title?: string; children: ReactNode }) {
  const { play, isPlaying } = useWorkbench();
  const on = isPlaying(clip.src);
  const Icon = on ? Pause : Play;
  return (
    <button type="button" className={cn(className ?? "vd-play", on && "vd-play-on")} title={title} aria-pressed={on} onClick={() => play(clip)}>
      <Icon size={13} aria-hidden="true" />
      {children}
    </button>
  );
}
