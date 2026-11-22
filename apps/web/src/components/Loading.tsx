"use client";

import { Loader2 } from "lucide-react";

import { useUiText } from "@/components/UiTextProvider";

/**
 * What an explorer shows until its first page of rows arrives, and what a section's route
 * shows while the server is still rendering it (app/<section>/loading.tsx).
 *
 * One component for all three sections so a slow page looks the same wherever it is slow.
 * Tall enough to hold the space the table will take, so the pagination and the player do
 * not jump up and then back down when the rows land.
 *
 * A client component for its words: the layout's UiTextProvider is what carries them, and a
 * spinner that reads the reader's language is worth less than nothing reading it.
 */
export function Loading({ what = "lines" }: { what?: "lines" | "pages" }) {
  const words = useUiText().catalogue;
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex min-h-64 items-center justify-center gap-2 text-sm"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {what === "pages" ? words.loadingPages : words.loading}
    </div>
  );
}

/** The small spinner beside the count while a new search replaces rows already shown. */
export function Refreshing() {
  const words = useUiText().catalogue.updating;
  return (
    <Loader2
      className="text-muted-foreground size-3.5 animate-spin"
      aria-label={words}
    />
  );
}
