// A Spoken release's zip onto the manager channel, so players do not depend on GitHub's CDN for it.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { compareVersions, IMMUTABLE, INDEX_CACHE, readSigned } from "./publish.mjs";
import { publicKeyOf, sealJson, sha256Text } from "./sign.mjs";
import { ConflictError } from "./store.mjs";

const ZIP_NAME = /^Spoken-(\d+\.\d+\.\d+)\.zip$/;
const KEEP_ADDON_VERSIONS = 3;
// A voice pack press can be writing the index at the same moment.
const INDEX_ATTEMPTS = 5;

function nextAddons(entries, added) {
  return [...entries.filter((e) => e.version !== added.version), added]
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, KEEP_ADDON_VERSIONS);
}

export async function publishAddon({ store, signingKey, zipPath, clock = () => new Date(), dryRun = false, log = console.log }) {
  const name = basename(zipPath ?? "");
  const version = ZIP_NAME.exec(name)?.[1];
  if (!version) throw new Error(`${name} is not a stable Spoken-x.y.z.zip (betas stay on GitHub)`);
  const publicKey = publicKeyOf(signingKey);

  log(`step 1/3: hashing ${name}`);
  const bytes = await readFile(zipPath);
  const sha256 = sha256Text(bytes);
  const entry = { version, sha256, size: bytes.length };
  const key = `blobs/${sha256}`;
  log(`${bytes.length} bytes, sha256 ${sha256}`);

  log(`step 2/3: uploading to ${key}${dryRun ? " (dry run: nothing sent)" : ""}`);
  if (!dryRun && !(await store.head(key))) {
    await store.put(key, bytes, { contentType: "application/octet-stream", cacheControl: IMMUTABLE });
  }

  for (let attempt = 1; ; attempt++) {
    log(`step 3/3: updating index.json (attempt ${attempt}/${INDEX_ATTEMPTS})`);
    const current = await readSigned(store, "index.json", publicKey);
    if (!current) throw new Error("the channel has no index.json");
    const live = current.value.addons?.spoken ?? [];
    if (live.some((e) => e.version === version && e.sha256 === sha256)) {
      log(`Spoken ${version} is already on the channel`);
      return { key, changed: false };
    }
    const spoken = nextAddons(live, entry);
    log(`index would list Spoken ${spoken.map((e) => e.version).join(", ")}`);
    if (dryRun) return { key, changed: false };
    // Taken here, not at the start: a Manager refuses an index older than the one it has saved.
    const next = { ...current.value, generatedAt: clock().toISOString(), addons: { ...current.value.addons, spoken } };
    try {
      await store.put("index.json", sealJson(next, signingKey).text, { contentType: "application/json", cacheControl: INDEX_CACHE, ifMatch: current.etag });
      log(`Spoken ${version} is live on the channel`);
      return { key, changed: true };
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= INDEX_ATTEMPTS) throw err;
    }
  }
}
