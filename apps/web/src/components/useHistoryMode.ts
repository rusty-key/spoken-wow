"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Whether a write of the view to the URL pushes a history entry or replaces the current one.
 *
 * Every filter, page or narrowing change pushes, so Back returns to the view before it. A run
 * of typed-query writes gets one entry between them: the first pushes and the rest replace it,
 * or Back would step through the query a few letters at a time. Back or Forward ends the run,
 * so the next keystroke does not overwrite the entry it landed on.
 */
export function useHistoryMode() {
  const typing = useRef(false);

  useEffect(() => {
    const reset = () => {
      typing.current = false;
    };
    window.addEventListener("popstate", reset);
    return () => window.removeEventListener("popstate", reset);
  }, []);

  return useCallback((typed: boolean): "push" | "replace" => {
    const mode = typed && typing.current ? "replace" : "push";
    typing.current = typed;
    return mode;
  }, []);
}
