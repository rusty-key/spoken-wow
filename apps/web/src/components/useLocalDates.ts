import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const CLOCK: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };

/**
 * Formats dates for the viewer. The server knows neither their locale nor their time zone, and the
 * first browser render has to match its HTML, so that render uses fixed ones and the viewer's take
 * over right after.
 */
export function useLocalDates() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const format = (at: string, options: Intl.DateTimeFormatOptions = CLOCK) =>
    hydrated
      ? new Date(at).toLocaleString(undefined, options)
      : new Date(at).toLocaleString("en-GB", { ...options, timeZone: "UTC" });
  return format;
}
