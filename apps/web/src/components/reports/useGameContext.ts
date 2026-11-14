"use client";

/**
 * The envelope the addon put in the report link's #e1= fragment, decoded in the browser, for
 * every part of an /r/ page that reads it: the note above the player and the form.
 *
 * Kept in sessionStorage under the page's path, because choosing which of an NPC's lines to
 * report is a navigation to ?line=, and a link carries no fragment along. Taken out of the
 * address bar once read, as ContributeForm does, so the game text does not linger in history.
 * Read once per page load and shared, since the first reader takes the fragment away.
 */
import { useEffect, useState } from "react";

import { decodeFragment, takeFragment } from "@/lib/contributions/envelope";

const STORED = "spoken.report.context";
const reads = new Map<string, Promise<string | null>>();

async function read(key: string, fragment: string | null): Promise<string | null> {
  if (fragment === null) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      // Storage blocked: the report goes without context.
      return null;
    }
  }
  const result = await decodeFragment(fragment);
  if (!result.ok) return null;
  try {
    window.sessionStorage.setItem(key, result.text);
  } catch {
    // As above.
  }
  return result.text;
}

function load(): Promise<string | null> {
  const key = `${STORED}:${window.location.pathname}`;
  // A fresh fragment replaces what an earlier link to the same page left.
  const fragment = takeFragment();
  let pending = fragment === null ? reads.get(key) : undefined;
  if (!pending) {
    pending = read(key, fragment);
    reads.set(key, pending);
  }
  return pending;
}

export function useGameContext(enabled: boolean): string | null {
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Not cancelled on cleanup: the hash is gone once read, so an effect run twice (React's
    // development double-invoke) gets the same shared read rather than nothing.
    void load().then(setRaw);
  }, [enabled]);

  return raw;
}
