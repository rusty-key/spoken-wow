"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Transient messages that must not move the page.
 *
 * Written here rather than pulled in as a dependency because what this needs is small and
 * specific: something to say what a request just cost, without the layout shifting under a
 * list someone is working down. A message that pushed the rows below it would be a message
 * that moved the button next to the one being aimed at.
 *
 * Deliberately not a queue with swipe-to-dismiss. Three at a time, oldest dropped, gone after a
 * few seconds - the information is worth glancing at. The one thing a toast may offer is to take
 * back what it reports, for a change saved on a single click; such a toast stays longer, and
 * none goes while the pointer or the keyboard is on it, so its Undo can be reached in time.
 */
export type ToastTone = "info" | "error";

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Takes back what the toast reports; offered until the toast goes. */
  undo?: () => void;
};

const MAX_VISIBLE = 3;
const DISMISS_MS = 6000;
const UNDO_MS = 12_000;
/** After the pointer or focus leaves, so a toast does not vanish as it is let go. */
const LINGER_MS = 3000;

const ToastContext = createContext<((toast: Omit<Toast, "id">) => void) | null>(null);

export function useToast(): (toast: Omit<Toast, "id">) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <Toaster> above it");
  return show;
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const drop = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);
  const schedule = useCallback(
    (id: number, ms: number) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => drop(id), ms));
    },
    [drop],
  );
  const hold = (id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  };

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      // Date.now() would collide for two toasts raised in the same millisecond, which is
      // exactly what a cached preview followed by an error does.
      const id = nextId++;
      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE));
      schedule(id, toast.undo ? UNDO_MS : DISMISS_MS);
    },
    [schedule],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live rather than role="alert" per toast: this is a running commentary on what
          the page just did, and interrupting a screen reader for each one would be worse
          than letting them queue. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onMouseEnter={() => hold(toast.id)}
            onMouseLeave={() => schedule(toast.id, LINGER_MS)}
            onFocus={() => hold(toast.id)}
            onBlur={() => schedule(toast.id, LINGER_MS)}
            className={cn(
              "bg-popover text-popover-foreground pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg",
              toast.tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{toast.title}</p>
                {toast.detail && (
                  <p className={cn("mt-0.5 text-xs", toast.tone === "error" || "text-muted-foreground")}>
                    {toast.detail}
                  </p>
                )}
              </div>
              {toast.undo && (
                <button
                  type="button"
                  className="text-primary-ink -my-0.5 rounded px-1.5 py-0.5 text-sm font-medium hover:underline"
                  onClick={() => {
                    toast.undo?.();
                    drop(toast.id);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

let nextId = 0;
