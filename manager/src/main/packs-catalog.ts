// Voice packs the manager channel carries, as the catalog and the statuses see them: each is one
// "release" whose tag names the rev of each of its folders, so a status is a tag comparison.
import { channelTag } from '../shared/channel'
import type { Catalog, Product, ReleaseInfo } from '../shared/types'
import { compareReleases } from './catalog'
import { REPO } from './github'
import type { ChannelAddon, ChannelIndex } from './packs-remote'

/** The newest of a set of revs; they sort as text. */
export function newestRev(revs: string[]): string {
  return [...revs].sort().at(-1)!
}

/** `20261018T142233Z` -> `2026-10-18T14:22:33Z`. */
export function revToIso(rev: string): string {
  return `${rev.slice(0, 4)}-${rev.slice(4, 6)}-${rev.slice(6, 8)}T${rev.slice(9, 11)}:${rev.slice(11, 13)}:${rev.slice(13, 15)}Z`
}

/** The product as one channel release, or null when the channel does not carry every one of its folders. */
export function channelRelease(product: Product, index: ChannelIndex | null, baseUrl: string): ReleaseInfo | null {
  if (product.kind !== 'voices' || !index || !product.folders || product.folders.length === 0) return null
  const packs = product.folders.map((f) => index.packs[f])
  if (packs.some((p) => !p)) return null
  const revs = packs.map((p) => p!.rev)
  const newest = newestRev(revs)
  return {
    productId: product.id,
    tag: channelTag(revs),
    version: newest,
    prerelease: false,
    publishedAt: revToIso(newest),
    notes: '',
    assetName: '',
    assetSize: packs.reduce((n, p) => n + p!.totalSize, 0),
    assetUrl: baseUrl,
    htmlUrl: ''
  }
}

/**
 * A product's releases with the channel's zips as their first source and GitHub as their second. A version GitHub's
 * list lacks is added, so a new release still shows when that list cannot be fetched.
 */
export function withAddonCopies(product: Product, list: readonly ReleaseInfo[], copies: readonly ChannelAddon[], baseUrl: string): ReleaseInfo[] {
  const out = [...list]
  for (const copy of copies) {
    const at = out.findIndex((r) => r.version === copy.version)
    const github = at >= 0 ? out[at]! : unlistedRelease(product, copy)
    out[at >= 0 ? at : out.length] = { ...github, assetUrl: `${baseUrl}blobs/${copy.sha256}`, assetSize: copy.size, digest: `sha256:${copy.sha256}`, fallbackUrl: github.assetUrl }
  }
  return out.sort(compareReleases)
}

function unlistedRelease(product: Product, copy: ChannelAddon): ReleaseInfo {
  const tag = `${product.tagPrefix}/v${copy.version}`
  const assetName = `Spoken-${copy.version}.zip`
  return {
    productId: product.id,
    tag,
    version: copy.version,
    prerelease: false,
    publishedAt: '',
    notes: '',
    assetName,
    assetSize: copy.size,
    assetUrl: `https://github.com/${REPO}/releases/download/${tag}/${assetName}`,
    htmlUrl: ''
  }
}

/** The catalog with every voice product the channel fully carries offered from the channel instead of GitHub. */
export function withChannel(catalog: Catalog, products: readonly Product[], index: ChannelIndex | null, baseUrl: string): Catalog {
  if (!index) return catalog
  const releases = { ...catalog.releases }
  for (const p of products) {
    const copies = index.addons?.[p.id]
    if (copies) releases[p.id] = withAddonCopies(p, releases[p.id] ?? [], copies, baseUrl)
    const r = channelRelease(p, index, baseUrl)
    if (r) releases[p.id] = [r]
  }
  return { ...catalog, releases }
}
