/** "1 line", "2 lines", or "? lines" for a count that is not known. */
export function plural(n: number | null, noun: string, nouns = `${noun}s`): string {
  return `${n === null ? "?" : n.toLocaleString()} ${n === 1 ? noun : nouns}`;
}
