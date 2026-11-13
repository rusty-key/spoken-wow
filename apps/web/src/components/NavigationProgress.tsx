"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * A thin bar across the top of the page while a navigation is on its way.
 *
 * Every page is rendered per request, and the router keeps the old page up until the new
 * one arrives. A click on a link therefore did nothing visible for as long as the server
 * took, which is longest exactly when an explorer's own searches are in flight, and read as
 * a link that had not worked. The bar starts on the click and finishes when the URL moves.
 */

let pending = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (pending === next) return;
  pending = next;
  for (const listener of listeners) listener();
}

/** For a navigation that is not a link click: usePendingPush says when it starts and ends. */
export function startNavigation() {
  set(true);
}

export function finishNavigation() {
  set(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether a click is one the router took and that goes somewhere else.
 *
 * Listening on the document, after React's own handlers, is what makes defaultPrevented
 * mean "next/link handled this": a modified click, a download or target=_blank is left to
 * the browser and never prevented. A link to the page already open would never move the
 * URL, and would leave the bar running.
 */
function isRouterNavigation(event: MouseEvent) {
  if (!event.defaultPrevented || event.button !== 0) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  const url = new URL(anchor.href, window.location.href);
  return (
    url.origin === window.location.origin &&
    url.pathname + url.search !== window.location.pathname + window.location.search
  );
}

type Phase = "idle" | "loading" | "done";

export default function NavigationProgress() {
  const active = useSyncExternalStore(subscribe, () => pending, () => false);
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");

  // The URL moves when the new page commits, whichever way it was asked for.
  useEffect(() => finishNavigation(), [pathname, search]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (isRouterNavigation(event)) startNavigation();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (active) {
      // A beat before showing it, so a prefetched page that lands at once does not flash
      // a bar; and it leaves "idle" painted at zero width for the slide to start from.
      const timer = setTimeout(() => setPhase("loading"), 100);
      return () => clearTimeout(timer);
    }
    setPhase((current) => (current === "loading" ? "done" : "idle"));
  }, [active]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => setPhase("idle"), 400);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className="bg-primary-ink h-full"
        style={
          phase === "loading"
            ? // Slows as it goes and never reaches the end on its own: how long the server
              // takes is not known, only that it has not answered yet.
              { width: "90%", transition: "width 8s cubic-bezier(0.1, 0.7, 0.2, 1)" }
            : phase === "done"
              ? { width: "100%", opacity: 0, transition: "width 150ms, opacity 250ms 150ms" }
              : { width: 0, opacity: 0 }
        }
      />
    </div>
  );
}
