// What is installed for each product on one game, and how it compares with the catalog.
import fs from 'node:fs'
import path from 'node:path'
import type { Catalog, GameInstall, InstallState, Product, ProductStatus, Settings } from '../shared/types'
import { PRODUCTS } from '../shared/products'
import { compareVersions } from '../shared/version'
import { latestFor } from './catalog'
import { channelTag, isChannelRelease } from '../shared/channel'
import { loadPackState } from './packs-state'
import { LINKED_MESSAGE, allowedFolders, isLinked } from './guard'
import { getRecord, type StateFile } from './state'

/** The `## Version:` line of a toc file's text. */
export function parseTocVersion(text: string): string | undefined {
  const m = /^[ \t]*##[ \t]*Version[ \t]*:[ \t]*(.*?)[ \t]*$/im.exec(text.replace(/^﻿/, ''))
  return m && m[1] ? m[1] : undefined
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.lstat(p)
    return true
  } catch {
    return false
  }
}

async function tocVersion(addOns: string, folder: string): Promise<string | undefined> {
  try {
    const text = await fs.promises.readFile(path.join(addOns, folder, `${folder}.toc`), 'utf8')
    const v = parseTocVersion(text)
    return v && compareVersions(v, v) !== null ? v : undefined
  } catch {
    return undefined
  }
}

export async function computeStatuses(
  game: GameInstall,
  catalog: Catalog,
  settings: Settings,
  state: StateFile,
  /** The products to report on; community packs are added by the caller. */
  products: readonly Product[] = PRODUCTS
): Promise<ProductStatus[]> {
  const out: ProductStatus[] = []
  // An AddOns (or Interface) folder that is itself a link counts for every product installed in it.
  const addOnsLinked = (await isLinked(game.addOnsPath)) || (await isLinked(path.dirname(game.addOnsPath)))
  for (const product of products) {
    const hasReleases = (catalog.releases[product.id]?.length ?? 0) > 0

    const installedFolders: string[] = []
    for (const folder of allowedFolders(product)) {
      if (await exists(path.join(game.addOnsPath, folder))) installedFolders.push(folder)
    }
    if (!hasReleases && installedFolders.length === 0) continue

    const latest = latestFor(catalog, product.id, settings.includePrereleases || product.kind === 'community')
    const record = getRecord(state, game.id, product.id)

    let installedVersion: string | undefined
    if (installedFolders.length > 0) {
      // The toc is what the game reads; the manager's record fills in when a pack's toc has no version.
      installedVersion = (await tocVersion(game.addOnsPath, installedFolders[0]!)) ?? record?.version
    }

    let linked = addOnsLinked && installedFolders.length > 0
    for (const folder of installedFolders) {
      if (await isLinked(path.join(game.addOnsPath, folder))) {
        linked = true
        break
      }
    }

    let st: InstallState
    if (installedFolders.length === 0) st = 'not-installed'
    else if (linked) st = 'linked'
    // Only a pack's old folder is not a partial install: its update replaces it.
    else if (product.folders && product.folders.length > 1 && product.folders.some((f) => installedFolders.includes(f)) && product.folders.some((f) => !installedFolders.includes(f))) st = 'unknown'
    else if (latest && isChannelRelease(latest)) {
      // Judged per folder: a bundle and its split packs share folders, and each folder's pack state is what is on disk.
      const installedTag = channelTag((product.folders ?? []).map((f) => loadPackState(game, f)?.rev ?? ''))
      st = installedTag === latest.tag ? 'up-to-date' : 'update-available'
    }
    else if (!latest || !installedVersion) st = 'unknown'
    else {
      const c = compareVersions(installedVersion, latest.version)
      st = c === null ? 'unknown' : c < 0 ? 'update-available' : c > 0 ? 'ahead' : 'up-to-date'
    }

    const blockedReason = linked
      ? LINKED_MESSAGE
      : !game.writable
        ? 'The manager cannot write to this game folder. Check that it is not read-only and that your account may change it.'
        : undefined

    out.push({
      gameId: game.id,
      productId: product.id,
      state: st,
      ...(installedVersion ? { installedVersion } : {}),
      installedFolders,
      ...(latest ? { latest } : {}),
      ...(blockedReason ? { blockedReason } : {})
    })
  }
  return out
}
