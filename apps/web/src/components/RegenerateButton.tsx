"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onClick: () => void;
  busy?: boolean;
  /** Why the control is unavailable. Present means disabled, and says so on hover. */
  blocked?: string | null;
  /** Says "Regenerate" beside the icon, as the audio pages' rows do. */
  withLabel?: boolean;
};

/**
 * Re-run TTS over one line.
 *
 * `blocked` is almost always "this race-gender voice does not exist yet" - three of the
 * twenty do - so it carries the reason rather than just disabling: a control that greys out
 * with no explanation is worse than one that is not there.
 *
 * Regenerating more than one line is not this control: that acts on the whole search, is
 * priced first, and lives in the results header.
 */
export default function RegenerateButton({ onClick, busy = false, blocked, withLabel = false }: Props) {
  const label = blocked ?? "Regenerate this line";

  // The title sits on a wrapper, not the button: a disabled Button is pointer-events-none,
  // so a title on it never shows - which is exactly when the reason is needed.
  return (
    <span title={label} className="inline-flex">
      <Button
        variant="ghost"
        size={withLabel ? "xs" : "icon-xs"}
        aria-label={label}
        disabled={busy || Boolean(blocked)}
        onClick={onClick}
      >
        {busy ? <Loader2 className={cn("animate-spin")} /> : <RefreshCw />}
        {withLabel ? "Regenerate" : null}
      </Button>
    </span>
  );
}
