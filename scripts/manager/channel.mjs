// Publishing to the channel with what the environment holds: the keys, and the latest Spoken.
import { MIN_SPOKEN } from "../lib/packs.mjs";
import { delist, latestSpokenRelease, promote, publish } from "./publish.mjs";
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

export function promoteFromEnv(options) {
  return promote({ store: r2Store(process.env), signingKey: signingKeyFromEnv(), ...options });
}

export function delistFromEnv(options) {
  return delist({ store: r2Store(process.env), signingKey: signingKeyFromEnv(), ...options });
}

// fetch says only "fetch failed" and keeps what went wrong in `cause`.
export const errorText = (err) => {
  if (err instanceof ConflictError) return `error: ${err.message} was written by another publish while this one ran; run it again`;
  return `error: ${err.message}${err.cause?.message ? `: ${err.cause.message}` : ""}`;
};
