import { describe, expect, it } from 'vitest'
import { cfPublicVersions, ghHasAsset } from '../src/main/contributor-status'
import { checkCfToken, checkGhRepo, resolveGameVersions, uploadCurseForge, uploadGitHub } from '../src/main/contributor-upload'
import { CancelledError, PlainError } from '../src/main/errors'
import { tmpDir, write } from './helpers'

const TOKEN = 'sekrit-token-123'

/** Answers everything with `body` and keeps each request's options. */
function recording(body: unknown = []) {
  const inits: RequestInit[] = []
  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    inits.push(init)
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return { inits, fetchImpl }
}

function zipFile(): string {
  const zip = `${tmpDir()}/p.zip`
  write(zip, 'zip')
  return zip
}

describe('requests that carry a token', () => {
  it('none of them follows a redirect', async () => {
    const signal = new AbortController().signal
    const a = { token: TOKEN, folder: 'F', version: '1.0.0', notes: 'n', signal }
    const calls: Array<(f: typeof fetch) => Promise<unknown>> = [
      (f) => checkCfToken(TOKEN, f),
      (f) => checkGhRepo(TOKEN, 'o/r', f),
      (f) => resolveGameVersions(TOKEN, '', f),
      (f) => ghHasAsset('o/r', TOKEN, 'F', '1.0.0', f),
      (f) => uploadCurseForge({ ...a, project: '1', zip: zipFile(), gameVersionIds: [], fetchImpl: f }),
      (f) => uploadGitHub({ ...a, repo: 'o/r', zip: zipFile(), fetchImpl: f })
    ]
    for (const call of calls) {
      const { inits, fetchImpl } = recording({ id: 5, assets: [] })
      // The answer is one size for all; only the request's options matter here.
      await call(fetchImpl).catch(() => undefined)
      expect(inits.length).toBeGreaterThan(0)
      for (const init of inits) expect(init.redirect).toBe('error')
    }
  })

  it('the delete of a partial GitHub asset does not follow a redirect either', async () => {
    const { inits, fetchImpl } = recording({ id: 5, assets: [{ id: 9, name: 'F-1.0.0.zip', state: 'starter' }] })
    await uploadGitHub({ token: TOKEN, folder: 'F', version: '1.0.0', notes: 'n', signal: new AbortController().signal, repo: 'o/r', zip: zipFile(), fetchImpl }).catch(() => undefined)
    const del = inits.find((i) => i.method === 'DELETE')
    expect(del?.redirect).toBe('error')
    expect(del?.signal).toBeInstanceOf(AbortSignal)
  })

  it('the checks a save makes have a timeout, with no signal of the caller', async () => {
    for (const call of [(f: typeof fetch) => checkCfToken(TOKEN, f), (f: typeof fetch) => checkGhRepo(TOKEN, 'o/r', f).catch(() => undefined)]) {
      const { inits, fetchImpl } = recording()
      await call(fetchImpl)
      expect(inits[0]!.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('a timeout reads as an unreachable store, not as a cancel', async () => {
    const timedOut = (() => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch
    await expect(checkCfToken(TOKEN, timedOut)).rejects.toBeInstanceOf(PlainError)
    await expect(resolveGameVersions(TOKEN, '1.0', timedOut, new AbortController().signal)).rejects.toThrow(/Could not reach/)
  })
})

describe('a caller\'s signal', () => {
  const abortable = (seen: AbortSignal[]) =>
    ((_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        seen.push(init.signal!)
        init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as typeof fetch

  it('stops resolveGameVersions as a cancel', async () => {
    const c = new AbortController()
    const asked = resolveGameVersions(TOKEN, '1.0', abortable([]), c.signal)
    c.abort()
    await expect(asked).rejects.toBeInstanceOf(CancelledError)
  })

  it('a cancel while reading the game versions is a cancel, not an unreadable list', async () => {
    const c = new AbortController()
    const cutShort = (async () => {
      c.abort()
      return new Response('{"cut')
    }) as typeof fetch
    await expect(resolveGameVersions(TOKEN, '1.0', cutShort, c.signal)).rejects.toBeInstanceOf(CancelledError)
  })

  it('reaches cfPublicVersions and ghHasAsset', async () => {
    const c = new AbortController()
    const seen: AbortSignal[] = []
    const asked = [cfPublicVersions('1', abortable(seen), c.signal), ghHasAsset('o/r', TOKEN, 'F', '1.0.0', abortable(seen), c.signal)]
    c.abort()
    expect(await Promise.all(asked)).toEqual([null, null])
    expect(seen.every((s) => s.aborted)).toBe(true)
  })
})
