// Generating: the author's queued lines, voiced on this machine with their own key.
//
// The protocol is the site's own (apps/web/src/lib/worker/protocol.ts), bundled as it is, so
// the Manager and a browser tab on /generate send the same requests and refuse the same hosts.
// What is the Manager's alone is where the site is.
export {
  cachedVoices,
  localKeys,
  NotPaired,
  pollPairing,
  providerOf,
  runRound,
  sendRequest,
  startPairing,
  whoAmI,
  type ClaimedJob,
  type Provider as GenerateProvider
} from '@site-worker/protocol'

export const SITE_URL = 'https://spoken.rusty.one'
