/** What the explorer shows for a page no language it can borrow from has words for. */
export const NO_TEXT = "<no text>";

/** A page's words as the explorer shows them. */
export function shownText(line: { text: string; missing?: { text: boolean } }): string {
  return line.missing?.text && line.text === "" ? NO_TEXT : line.text;
}
