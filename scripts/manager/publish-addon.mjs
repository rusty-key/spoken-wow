// A Spoken release's zip onto the manager channel, so players do not depend on GitHub's CDN for it.
// The zip's name is its hash: a key cached for a year must never come to hold different bytes.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { compareVersions, IMMUTABLE, INDEX_CACHE } from "./publish.mjs";
import { openJson, publicKeyOf, sealJson, sha256Text } from "./sign.mjs";
import { ConflictError } from "./store.mjs";

const VERSION = /^\d+\.\d+\.\d+$/;
export const KEEP_ADDON_VERSIONS = 3;
// A voice pack press can be writing the index at the same moment.
const INDEX_ATTEMPTS = 5;

export const addonKey = (sha256) => `addons/spoken/${sha256}.zip`;

export function nextAddons(entries, added) {
  return [...entries.filter((e) => e.version !== added.version), added]
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, KEEP_ADDON_VERSIONS);
}

export async function publishAddon({ store, signingKey, zipPath, version, clock = () => new Date(), dryRun = false, log = console.log }) {
  if (!VERSION.test(version ?? "")) throw new Error(`${version} is not a stable Spoken version (betas stay on GitHub)`);
  const expected = `Spoken-${version}.zip`;
  if (basename(zipPath ?? "") !== expected) throw new Error(`expected a file named ${expected}, got ${zipPath}`);
  const publicKey = publicKeyOf(signingKey);

  log(`step 1/3: hashing ${expected}`);
  const bytes = await readFile(zipPath);
  const sha256 = sha256Text(bytes);
  const entry = { version, sha256, size: bytes.length };
  const key = addonKey(sha256);
  log(`${bytes.length} bytes, sha256 ${sha256}`);

  log(`step 2/3: uploading to ${key}${dryRun ? " (dry run: nothing sent)" : ""}`);
  if (!dryRun && !(await store.head(key))) {
    await store.put(key, bytes, { contentType: "application/zip", cacheControl: IMMUTABLE });
  }

  for (let attempt = 1; ; attempt++) {
    log(`step 3/3: updating index.json (attempt ${attempt}/${INDEX_ATTEMPTS})`);
    const current = await store.get("index.json");
    if (!current) throw new Error("the channel has no index.json");
    const { value } = openJson(current.body.toString("utf8"), publicKey);
    const live = value.addons?.spoken ?? [];
    if (live.some((e) => e.version === version && e.sha256 === sha256)) {
      log(`Spoken ${version} is already on the channel`);
      return { key, changed: false };
    }
    const spoken = nextAddons(live, entry);
    log(`index would list Spoken ${spoken.map((e) => e.version).join(", ")}`);
    if (dryRun) return { key, changed: false };
    // Taken here, not at the start: a Manager refuses an index older than the one it has saved.
    const next = { ...value, generatedAt: clock().toISOString(), addons: { ...value.addons, spoken } };
    try {
      await store.put("index.json", sealJson(next, signingKey).text, { contentType: "application/json", cacheControl: INDEX_CACHE, ifMatch: current.etag });
      log(`Spoken ${version} is live on the channel`);
      return { key, changed: true };
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= INDEX_ATTEMPTS) throw err;
    }
  }
}
