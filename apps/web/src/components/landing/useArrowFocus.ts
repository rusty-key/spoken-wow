import { useEffect, type RefObject } from "react";

/**
 * Hands focus on when an arrow hides at the end of a row. Left alone, a keyboard user who pressed
 * the arrow until it vanished would be on an invisible control, or on the page body.
 */
export function useArrowFocus(
  edges: { start: boolean; end: boolean },
  row: RefObject<HTMLElement | null>,
  prev: RefObject<HTMLElement | null>,
  next: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const active = document.activeElement;
    const inRow = () => row.current?.querySelector<HTMLElement>("button");
    if (!edges.start && active === prev.current) (edges.end ? next.current : inRow())?.focus();
    if (!edges.end && active === next.current) (edges.start ? prev.current : inRow())?.focus();
  }, [edges, row, prev, next]);
}
