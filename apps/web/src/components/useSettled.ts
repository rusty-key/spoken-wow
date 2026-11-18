"use client";

import { useEffect, useState } from "react";

/** A promise's outcome: its value, or the message it failed with. */
export type Settled<T> = { value: T } | { error: string };

/**
 * What `promise` settled to, or undefined while it is pending (and for a null promise).
 *
 * For promises a server page hands down unawaited, so the page draws at once and the slow
 * part streams in after it. A rejection is held as its message rather than thrown: the part
 * that waited on it says what went wrong, and the rest of the page carries on.
 */
export function useSettled<T>(promise: Promise<T> | null): Settled<T> | undefined {
  const [settled, setSettled] = useState<Settled<T> | undefined>(undefined);
  useEffect(() => {
    if (!promise) return;
    let cancelled = false;
    promise.then(
      (value) => !cancelled && setSettled({ value }),
      (error: unknown) =>
        !cancelled && setSettled({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [promise]);
  return settled;
}
