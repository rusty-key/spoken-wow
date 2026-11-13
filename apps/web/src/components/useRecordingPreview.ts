"use client";

import { useSyncExternalStore } from "react";

/**
 * One <audio> for every recording on the page.
 *
 * A row's play button and a history entry's both play through it, so starting one stops
 * whatever else was playing, the way TakeSelector's popover does for takes. Module-level
 * rather than per row: a page has a hundred rows and only one of them is ever heard. The
 * page's main player is left alone, as TakeSelector leaves it.
 *
 * Each caller subscribes to its own URL's state, so starting a clip re-renders the two rows
 * it touches -- the one that stopped and the one that started -- rather than every row.
 */
let element: HTMLAudioElement | null = null;
let playing: string | null = null;
let failed: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function audio(): HTMLAudioElement {
  if (element) return element;
  element = new Audio();
  element.addEventListener("ended", () => {
    playing = null;
    notify();
  });
  // A media element's error does not bubble, and play() resolves in some browsers even for
  // a 404, so both paths end here (TakeSelector found this out the hard way).
  element.addEventListener("error", () => {
    if (playing) failed = playing;
    playing = null;
    notify();
  });
  return element;
}

function toggle(url: string) {
  const player = audio();
  failed = null;
  if (playing === url) {
    player.pause();
    playing = null;
  } else {
    player.src = url;
    playing = url;
    void player.play().catch(() => {
      if (playing === url) {
        failed = url;
        playing = null;
        notify();
      }
    });
  }
  notify();
}

/** Whether `url` is playing, or failed to, and the way to start or stop it. */
export function useRecordingPreview(url: string): { playing: boolean; failed: boolean; toggle: () => void } {
  const state = useSyncExternalStore(
    subscribe,
    () => (playing === url ? "playing" : failed === url ? "failed" : "idle"),
    () => "idle",
  );
  return { playing: state === "playing", failed: state === "failed", toggle: () => toggle(url) };
}
