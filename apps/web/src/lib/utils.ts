import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A click that ends a drag across text, which a row that toggles on click should ignore:
 * copying a phrase out of it should not fold it away under the cursor.
 */
export function endsSelection(): boolean {
  return window.getSelection()?.isCollapsed === false;
}

/**
 * Seconds as m:ss, for a player's elapsed and total readouts.
 *
 * Guards the non-finite case because an <audio> element reports NaN for duration until its
 * metadata has loaded, and "NaN:NaN" is what that renders as otherwise.
 */
export function timecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
