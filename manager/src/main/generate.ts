// The site's own worker protocol, bundled as it is, so the Manager and a /generate tab send
// the same requests and refuse the same hosts.
export {
  cachedVoices,
  localKeys,
  NotPaired,
  pollPairing,
  providerOf,
  runRound,
  sendRequest,
  startPairing,
  unpair,
  whoAmI,
  type ClaimedJob,
  type Provider as GenerateProvider
} from '@site-worker/protocol'

export const SITE_URL = 'https://spoken.rusty.one'
