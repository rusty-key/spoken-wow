// What the proxy field shows once a save or a clear comes back. Kept out of the page so it can be checked
// without a renderer: the rules are about ordering, not about the drawing.

export interface ProxyAnswer {
  /** The operation's own number, taken when it was sent. */
  seq: number
  /** The number of the newest operation sent since. */
  newest: number
  /** What that operation sent, already trimmed. */
  submitted: string
  /** What the field holds now. */
  typed: string
  /** What the main process saved. */
  saved: string
}

/**
 * The text the field should show, or null to leave it alone. A later save or clear makes an earlier answer
 * stale even when both came from the same draft: blur saved `proxy.example:8080` and "Follow the System" was
 * pressed before it came back, so the clear must win rather than be dropped as an answer about an old draft.
 */
export function proxyFieldAfter(a: ProxyAnswer): string | null {
  if (a.seq !== a.newest) return null
  return a.typed === a.submitted ? a.saved : null
}

/**
 * Whether a save should be sent at all. An unchanged draft is skipped, except while an earlier write is still
 * in flight: erase the field before that write lands and the stored value still looks like what is typed, so
 * skipping would leave the proxy on with an empty field showing, and the erasure never sent.
 */
export function shouldWriteProxy(a: { submitted: string; stored: string; newest: number; done: number }): boolean {
  if (a.submitted !== a.stored) return true
  return a.newest !== a.done
}
