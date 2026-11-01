// Publishing to the channel with what the environment holds: the keys, and the latest Spoken.
import { MIN_SPOKEN } from "../lib/packs.mjs";
import { latestSpokenRelease, publish } from "./publish.mjs";
import { ConflictError, r2Store } from "./store.mjs";

export function signingKeyFromEnv() {
  const key = process.env.SPOKEN_PACKS_SIGNING_KEY;
  if (!key) throw new Error("missing SPOKEN_PACKS_SIGNING_KEY");
  return key;
}

export async function publishFromEnv(options) {
  return publish({
    store: r2Store(process.env),
    signingKey: signingKeyFromEnv(),
    minSpoken: MIN_SPOKEN,
    latestSpoken: await latestSpokenRelease(),
    archiveUrl: process.env.SPOKEN_ARCHIVE_URL,
    ...options,
  });
}

export const errorText = (err) =>
  err instanceof ConflictError ? `error: ${err.message} was written by another publish while this one ran; run it again` : `error: ${err.message}`;
