/**
 * Whether a keypress belongs to whatever has focus rather than to a page's shortcuts.
 *
 * The shadcn Select trigger is a <button role="combobox">, not a <select>, so checking
 * tagName alone would let space both toggle audio and open the dropdown. A dialog owns the
 * keyboard while it is open.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
    target.isContentEditable ||
    !!target.closest('[role="combobox"],[role="listbox"],[role="dialog"]')
  );
}
