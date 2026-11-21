// What marks a release as one the manager channel serves, shared by the main process and the window.
import type { ReleaseInfo } from './types'

/** The tag of a channel install: `channel/` and the rev of each of the product's folders, in order. */
export const CHANNEL_TAG = 'channel/'

export function channelTag(revs: string[]): string {
  return CHANNEL_TAG + revs.join('+')
}

export function isChannelRelease(r: ReleaseInfo | undefined): boolean {
  return !!r && r.tag.startsWith(CHANNEL_TAG)
}
