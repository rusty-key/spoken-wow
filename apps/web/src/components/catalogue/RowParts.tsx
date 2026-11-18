"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: string;
  /** The accessible name, which names the line, so a screen reader hears whose line it acts on. */
  aria: string;
  title?: string;
  onClick: () => void;
  /** Gold when the line already carries what this action set: a rewrite, an ignore. */
  marked?: boolean;
};

/**
 * A row's actions in words: the common ones as buttons, the rare ones behind "More".
 *
 * Somebody who may only report gets that one action as a plain button, since a menu holding a
 * single item is one more click for nothing.
 */
export function RowActions({
  subject,
  primary,
  regenerate,
  more,
  badge,
}: {
  /** The line, as the action names say it, so the More button is not the same name on every row. */
  subject: string;
  primary: RowAction[];
  regenerate?: ReactNode;
  more: RowAction[];
  /** The open-reports chip, which stays in sight. */
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const inMenu = primary.length > 0 || regenerate ? more : [];
  const inline = inMenu.length > 0 ? primary : [...primary, ...more];

  return (
    <span className="cat-actions">
      {badge}
      {inline.map((action) => (
        <button
          key={action.aria}
          type="button"
          className={cn("bs-btn bs-btn-text cat-act", action.marked && "cat-marked")}
          aria-label={action.aria}
          title={action.title}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
      {regenerate}
      {inMenu.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="bs-btn bs-btn-text cat-act cat-more" aria-label={`More actions for ${subject}`} title="More actions">
              <MoreHorizontalIcon aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="cat-menu w-auto min-w-48 p-1">
            {inMenu.map((action) => (
              <button
                key={action.aria}
                type="button"
                className={cn("cat-menu-item", action.marked && "cat-marked")}
                aria-label={action.aria}
                title={action.title}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
              >
                {action.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

export type StateTone = "missing" | "stale" | "current" | "skip" | "error";

/** A line's audio state as a coloured dot and a word, the same colours as the status buttons. */
export function StateWord({ tone, title, children }: { tone: StateTone; title?: string; children: ReactNode }) {
  return (
    <span className={cn("cat-state", `cat-state-${tone}`)} title={title}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
