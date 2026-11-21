import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimatePack, listLocal, planPack, type LocalFile } from '../src/main/packs-plan'
import { loadPackState, savePackState, type PackState } from '../src/main/packs-state'
import type { ChannelManifest } from '../src/main/packs-remote'
import { makeGame, sha256, tmpDir, write } from './helpers'

const f = (p: string, text: string) => ({ path: p, sha256: sha256(Buffer.from(text)), size: Buffer.byteLength(text) })
const manifest = (files: ReturnType<typeof f>[]): ChannelManifest => ({
  packId: 'SpokenPlacesAudio_deDE', rev: '20261018T000000Z', requires: { Spoken: '>=3.0.0' },
  fileCount: files.length, totalSize: files.reduce((n, x) => n + x.size, 0), files
})
const local = (entries: [string, LocalFile][]) => new Map(entries)
const hashOf = (texts: Record<string, string>) => {
  const calls: string[] = []
  return { calls, hash: async (p: string) => (calls.push(p), sha256(Buffer.from(texts[p] ?? ''))) }
}

describe('planPack', () => {
  const m = manifest([f('a.toc', 'toc'), f('s/1.ogg', 'one'), f('s/2.ogg', 'two')])

  it('fetches everything for a fresh install', async () => {
    const plan = await planPack(m, null, local([]), hashOf({}).hash)
    expect(plan.map((x) => x.path)).toEqual(['a.toc', 's/1.ogg', 's/2.ogg'])
  })

  it('trusts the state when size and mtime match, and hashes nothing', async () => {
    const state: PackState = { packId: m.packId, rev: 'old', files: Object.fromEntries(m.files.map((x) => [x.path, { sha256: x.sha256, size: x.size, mtimeMs: 5 }])) }
    const h = hashOf({})
    const plan = await planPack(m, state, local(m.files.map((x) => [x.path, { size: x.size, mtimeMs: 5 }])), h.hash)
    expect(plan).toEqual([])
    expect(h.calls).toEqual([])
  })

  it('adopts a folder with no state by hashing, and fetches only what differs', async () => {
    const h = hashOf({ 'a.toc': 'toc', 's/1.ogg': 'one', 's/2.ogg': 'TWO' })
    const plan = await planPack(m, null, local(m.files.map((x) => [x.path, { size: x.size, mtimeMs: 1 }])), h.hash)
    expect(plan.map((x) => x.path)).toEqual(['s/2.ogg'])
    expect(h.calls.sort()).toEqual(['a.toc', 's/1.ogg', 's/2.ogg'])
  })

  it('a repair hashes even what the state vouches for', async () => {
    const state: PackState = { packId: m.packId, rev: 'old', files: Object.fromEntries(m.files.map((x) => [x.path, { sha256: x.sha256, size: x.size, mtimeMs: 5 }])) }
    const h = hashOf({ 'a.toc': 'toc', 's/1.ogg': 'ONE', 's/2.ogg': 'two' })
    const plan = await planPack(m, state, local(m.files.map((x) => [x.path, { size: x.size, mtimeMs: 5 }])), h.hash, false)
    expect(plan.map((x) => x.path)).toEqual(['s/1.ogg'])
  })

  it('a file of the wrong size is fetched without hashing', async () => {
    const h = hashOf({})
    const plan = await planPack(manifest([f('a.toc', 'toc')]), null, local([['a.toc', { size: 99, mtimeMs: 1 }]]), h.hash)
    expect(plan.length).toBe(1)
    expect(h.calls).toEqual([])
  })

  it('counts one clip used at two paths once', async () => {
    const m = manifest([f('a.ogg', 'same'), f('b.ogg', 'same')])
    expect(await planPack(m, null, local([]), hashOf({}).hash)).toHaveLength(2)
    expect(estimatePack(m, null)).toEqual({ files: 2, bytes: 4 })
  })
})

describe('estimatePack', () => {
  it('counts what the state does not already hold', () => {
    const m = manifest([f('a.toc', 'toc'), f('s/1.ogg', 'one')])
    const state: PackState = { packId: m.packId, rev: 'old', files: { 'a.toc': { sha256: m.files[0]!.sha256, size: 3, mtimeMs: 1 } } }
    expect(estimatePack(m, state)).toEqual({ files: 1, bytes: 3 })
  })
})

describe('pack state and listLocal', () => {
  it('round-trips and ignores a state for another pack', async () => {
    const game = await makeGame(tmpDir())
    savePackState(game, { packId: 'SpokenPlacesAudio_deDE', rev: 'r', files: { a: { sha256: 'x', size: 1, mtimeMs: 2 } } })
    expect(loadPackState(game, 'SpokenPlacesAudio_deDE')?.files.a?.size).toBe(1)
    expect(loadPackState(game, 'SpokenPlacesAudio_frFR')).toBeNull()
  })

  it('lists files by / path and skips symlinks', async () => {
    const dir = tmpDir()
    write(path.join(dir, 'a.toc'), 'toc')
    write(path.join(dir, 's', '1.ogg'), 'one')
    fs.symlinkSync(path.join(dir, 'a.toc'), path.join(dir, 'link.toc'))
    expect([...(await listLocal(dir)).keys()].sort()).toEqual(['a.toc', 's/1.ogg'])
    expect((await listLocal(path.join(dir, 'missing'))).size).toBe(0)
  })
})
