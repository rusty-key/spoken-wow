import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type JobProgress } from '../src/shared/types'
import { CancelledError, PlainError } from '../src/main/errors'
import { JobManager } from '../src/main/jobs'
import {
  getRecord,
  initLog,
  loadSettings,
  loadState,
  log,
  removeRecord,
  sanitizeSettings,
  saveSettings,
  saveState,
  setRecord,
  writeJsonAtomic
} from '../src/main/state'
import { tmpDir } from './helpers'

function tick(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('JobManager', () => {
  it('runs one job at a time per game and different games side by side', async () => {
    const events: JobProgress[] = []
    const jm = new JobManager((p) => events.push(p))
    const order: string[] = []
    let releaseA!: () => void
    const gate = new Promise<void>((r) => (releaseA = r))
    const spec = (gameId: string, productId: string, wait?: Promise<void>) => ({
      gameId,
      productId,
      action: 'install' as const,
      run: async () => {
        order.push(`start ${gameId}/${productId}`)
        if (wait) await wait
        order.push(`end ${gameId}/${productId}`)
      }
    })
    jm.enqueue(spec('g1', 'a', gate))
    jm.enqueue(spec('g1', 'b'))
    jm.enqueue(spec('g2', 'c'))
    await tick()
    expect(order).toEqual(['start g1/a', 'start g2/c', 'end g2/c'])
    releaseA()
    await tick()
    expect(order.slice(3)).toEqual(['end g1/a', 'start g1/b', 'end g1/b'])
    expect(events.filter((e) => e.phase === 'queued')).toHaveLength(3)
    expect(events.filter((e) => e.phase === 'done')).toHaveLength(3)
  })

  it('returns the same id for the same product while it waits or runs', async () => {
    const jm = new JobManager(() => undefined)
    let go!: () => void
    const gate = new Promise<void>((r) => (go = r))
    const spec = { gameId: 'g', productId: 'p', action: 'install' as const, run: () => gate }
    const a = jm.enqueue(spec)
    const b = jm.enqueue(spec)
    expect(b).toBe(a)
    go()
    await tick()
    expect(jm.enqueue({ ...spec, run: async () => undefined })).not.toBe(a)
  })

  it('cancels a queued job without running it, and aborts a running one', async () => {
    const events: JobProgress[] = []
    const jm = new JobManager((p) => events.push(p))
    let ran = false
    const first = jm.enqueue({
      gameId: 'g',
      productId: 'a',
      action: 'install',
      run: ({ signal }) =>
        new Promise<void>((_res, rej) => signal.addEventListener('abort', () => rej(new CancelledError())))
    })
    const second = jm.enqueue({
      gameId: 'g',
      productId: 'b',
      action: 'install',
      run: async () => {
        ran = true
      }
    })
    expect(jm.cancel(second)).toBe(true)
    expect(jm.cancel(first)).toBe(true)
    await tick()
    expect(ran).toBe(false)
    const phases = (id: string) => events.filter((e) => e.jobId === id).map((e) => e.phase)
    expect(phases(second)).toEqual(['queued', 'cancelled'])
    expect(phases(first)).toEqual(['queued', 'cancelled'])
    expect(jm.cancel(first)).toBe(false)
    expect(jm.cancel('nope')).toBe(false)
    expect(events.filter((e) => e.jobId === first).at(-1)!.message).toBe('Cancelled.')
  })

  it('turns a plain error into an error event with its words, and any other error into a generic one', async () => {
    const events: JobProgress[] = []
    const jm = new JobManager((p) => events.push(p))
    const a = jm.enqueue({ gameId: 'g', productId: 'a', action: 'install', run: async () => { throw new PlainError('Spoken: This folder is linked.') } })
    await tick()
    const b = jm.enqueue({ gameId: 'g', productId: 'b', action: 'uninstall', run: async () => { throw new Error('ENOENT: boom') } })
    await tick()
    const last = (id: string) => events.filter((e) => e.jobId === id).at(-1)
    expect(last(a)).toMatchObject({ phase: 'error', message: 'Spoken: This folder is linked.' })
    expect(last(b)).toMatchObject({ phase: 'error', action: 'uninstall', message: 'Something went wrong: ENOENT: boom' })
  })

  it('does not break when the broadcast throws, and does not send a second done', async () => {
    let n = 0
    const seen: string[] = []
    const jm = new JobManager((p) => {
      n++
      seen.push(p.phase)
      throw new Error('window closed')
    })
    jm.enqueue({ gameId: 'g', productId: 'a', action: 'install', run: async ({ emit }) => emit({ jobId: 'x', gameId: 'g', productId: 'a', action: 'install', phase: 'done', received: 0, total: 0, bytesPerSecond: 0 }) })
    await tick()
    expect(seen).toEqual(['queued', 'done'])
    expect(n).toBe(2)
  })
})

describe('settings and state files', () => {
  it('merges defaults and ignores wrong types and unknown keys', () => {
    expect(sanitizeSettings({ includePrereleases: true, checkOnStart: 'yes', downloadsPath: 5, extra: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      includePrereleases: true
    })
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips settings and survives a damaged file', () => {
    const data = tmpDir()
    expect(loadSettings(data)).toEqual(DEFAULT_SETTINGS)
    saveSettings(data, { ...DEFAULT_SETTINGS, voiceLanguage: 'deDE' })
    expect(loadSettings(data).voiceLanguage).toBe('deDE')
    fs.writeFileSync(path.join(data, 'settings.json'), '{oops')
    expect(loadSettings(data)).toEqual(DEFAULT_SETTINGS)
  })

  it('writes atomically: no temp file is left behind', () => {
    const data = tmpDir()
    writeJsonAtomic(path.join(data, 'a', 'b.json'), { x: 1 })
    expect(fs.readdirSync(path.join(data, 'a'))).toEqual(['b.json'])
  })

  it('stores install records per game and product, and drops them', () => {
    const data = tmpDir()
    const st = loadState(data)
    setRecord(st, 'g1', 'spoken', { version: '1', folders: ['Spoken'], installedAt: 't', tag: 'spoken/v1' })
    saveState(data, st)
    const again = loadState(data)
    expect(getRecord(again, 'g1', 'spoken')?.version).toBe('1')
    expect(getRecord(again, 'g2', 'spoken')).toBeUndefined()
    removeRecord(again, 'g1', 'spoken')
    expect(again.installs).toEqual({})
  })

  it('drops malformed records when loading', () => {
    const data = tmpDir()
    fs.writeFileSync(
      path.join(data, 'state.json'),
      JSON.stringify({ manualGames: ['C:\\x', 5], installs: { g: { ok: { version: '1', folders: ['A', 2] }, bad: { folders: [] }, worse: 3 } } })
    )
    const st = loadState(data)
    expect(st.manualGames).toEqual(['C:\\x'])
    expect(Object.keys(st.installs.g!)).toEqual(['ok'])
    expect(st.installs.g!.ok!.folders).toEqual(['A'])
  })
})

describe('log', () => {
  it('writes plain lines with the time and keeps about 1 MB', () => {
    const data = tmpDir()
    initLog(data)
    log('hello', { a: 1 }, new Error('x').message)
    const file = path.join(data, 'logs', 'manager.log')
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z hello \{"a":1\} x\n$/)
    fs.writeFileSync(file, 'x'.repeat(1024 * 1024 + 10))
    log('after')
    expect(fs.existsSync(`${file}.1`)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('after')
    expect(fs.statSync(file).size).toBeLessThan(1000)
  })
})
