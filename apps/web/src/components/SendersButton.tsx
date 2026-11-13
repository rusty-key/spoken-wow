"use client";

import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Senders = { senders: { name: string; count: number }[]; anonymous: number };

/** A contribution's count, opening who sent it. Fetched on open: most counts are never pressed. */
export default function SendersButton({ id, count }: { id: number; count: number }) {
  const [senders, setSenders] = useState<Senders | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    const response = await fetch(`/api/contributions/senders?id=${id}`).catch(() => null);
    if (!response?.ok) {
      setError(true);
      return;
    }
    setSenders((await response.json()) as Senders);
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Who sent it"
          className="hover:bg-muted cursor-pointer rounded px-1 underline decoration-dotted underline-offset-2"
        >
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 text-xs"
        // Portalled, but React still bubbles the click to the row, whose handler folds it.
        onClick={(event) => event.stopPropagation()}
      >
        {error ? (
          <p className="text-destructive">Couldn&apos;t load who sent it.</p>
        ) : senders === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {senders.senders.map((sender, index) => (
              <li key={index} className="flex justify-between gap-2">
                <span className="truncate">{sender.name}</span>
                <span className="text-muted-foreground">×{sender.count}</span>
              </li>
            ))}
            {senders.anonymous > 0 ? (
              <li className="text-muted-foreground flex justify-between gap-2">
                <span>Anonymous</span>
                <span>×{senders.anonymous}</span>
              </li>
            ) : null}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
