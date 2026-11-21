import { describe, expect, it } from 'vitest'
import { proxyFieldAfter, shouldWriteProxy } from '../src/renderer/src/proxy-field'

const stored = 'http://proxy.example:8080'

describe('what the proxy field shows when a save comes back', () => {
  it('shows the saved address, which the main process may have normalized', () => {
    expect(proxyFieldAfter({ seq: 1, newest: 1, submitted: 'proxy.example:8080', typed: 'proxy.example:8080', saved: stored })).toBe(stored)
  })

  it('leaves the field alone when it has been typed in since, so a newer edit is not overwritten', () => {
    expect(proxyFieldAfter({ seq: 1, newest: 1, submitted: 'proxy.example:8080', typed: 'other:9090', saved: stored })).toBeNull()
  })

  it('leaves it alone when a later save or clear has been sent, even from the same draft', () => {
    // Blur saved `proxy.example:8080`, then "Follow the System" was pressed: both captured that draft, and the
    // clear must win rather than be discarded as a stale answer about an old draft.
    expect(proxyFieldAfter({ seq: 1, newest: 2, submitted: 'proxy.example:8080', typed: 'proxy.example:8080', saved: stored })).toBeNull()
    // The clear is the newest, so its empty answer is the one that lands.
    expect(proxyFieldAfter({ seq: 2, newest: 2, submitted: 'proxy.example:8080', typed: 'proxy.example:8080', saved: '' })).toBe('')
  })
})

describe('whether a save is sent at all', () => {
  it('skips a draft that matches what is stored, when nothing is in flight', () => {
    expect(shouldWriteProxy({ submitted: stored, stored, newest: 2, done: 2 })).toBe(false)
  })

  it('sends a draft that differs from what is stored', () => {
    expect(shouldWriteProxy({ submitted: 'other:9090', stored, newest: 2, done: 2 })).toBe(true)
  })

  it('sends a reverted draft while an earlier save is pending', () => {
    // Empty stored, `proxy.example:8080` blurred, then the field erased before that save came back. The
    // stored value still reads as empty, so skipping here would leave the proxy on with nothing on screen.
    expect(shouldWriteProxy({ submitted: '', stored: '', newest: 1, done: 0 })).toBe(true)
  })
})
