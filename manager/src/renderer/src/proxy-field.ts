// The proxy field's ordering rules, kept out of the page so they can be tested without a renderer.

export interface ProxyAnswer {
  /** The operation's own number, taken when it was sent. */
  seq: number
  /** The number of the newest operation sent since. */
  newest: number
  /** What that operation sent, already trimmed. */
  submitted: string
  typed: string
  saved: string
}

/**
 * The text the field should show, or null to leave it alone. Only the newest operation answers, even when an
 * older one came from the same draft: a clear pressed while a blur save is pending must win.
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
