// One publish of the manager channel: what dist/ holds now, against what the bucket says is live.
// Blobs, then manifests, then the index; the index write is the only one players see, and it is
// conditional, so two publishes racing cannot both win. Spec:
// docs/superpowers/specs/2026-10-18-manager-delta-packs-design.md
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readPointer } from "../lib/clip-pointer.mjs";
import { archiveBase, fetchRetrying } from "../lib/download.mjs";
import { buildManifest, caseDuplicate, diffFiles, hashFolder, revOf } from "./manifest.mjs";
import { openJson, publicKeyOf, sealJson, sha256Text } from "./sign.mjs";

// The pack ids the manager accepts: an index entry it rejects hides the whole channel.
const PACK_ID = /^Spoken[A-Za-z]+(_[a-z]{2}[A-Z]{2})?$/;

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const INDEX_CACHE = "public, max-age=60";

// A sync or pull that came up short looks like a pack losing its clips, and players would lose them.
const MAX_REMOVED_FILES = 5;
const MAX_REMOVED_SHARE = 0.05;

export function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

// Runs fn over items, `limit` at a time; the first failure stops new work and is thrown.
export async function eachLimit(items, limit, fn) {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// The releases list is newest first and mixes in per-language audio releases, so spoken/v tags can
// sit past page 1. Pages are read until one holds a spoken/v release, the list runs out, or 10 pages.
export async function latestSpokenRelease(fetchImpl = fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
  const versions = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/rusty-key/spoken-wow/releases?per_page=100&page=${page}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
    const releases = await res.json();
    if (releases.length === 0) break;
    for (const r of releases) {
      if (r.draft || r.prerelease) continue;
      const v = /^spoken\/v(\d+\.\d+\.\d+)$/.exec(r.tag_name)?.[1];
      if (v) versions.push(v);
    }
    if (versions.length > 0) break;
  }
  if (versions.length === 0) throw new Error("no published Spoken release");
  return versions.sort(compareVersions).at(-1);
}

async function readSigned(store, key, publicKey) {
  const o = await store.get(key);
  if (!o) return null;
  return { ...openJson(o.body.toString("utf8"), publicKey), etag: o.etag };
}

// A pointer's manifest entry is the clip it names, never the pointer's own bytes.
async function resolvePointers(root, files, archived) {
  for (const f of files) {
    const pointer = /\.(mp3|ogg)$/.test(f.path) ? await readPointer(join(root, ...f.path.split("/"))) : null;
    if (!pointer) continue;
    f.sha256 = pointer.sha256;
    f.size = pointer.size;
    archived.set(pointer.sha256, pointer);
  }
}

async function archivedBytes({ key, sha256, size }, archiveUrl, fetchImpl) {
  const res = await fetchRetrying(`${archiveBase(archiveUrl)}${key}`, fetchImpl);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status} from the archive`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== size || sha256Text(bytes) !== sha256) throw new Error(`${key}: the archive's bytes do not match their name`);
  return bytes;
}

export async function publish({ store, packs: allPacks, distDir, signingKey, minSpoken, latestSpoken, cache, now = new Date(), dryRun = false, allowRemovals = false, onlyPresent = false, archiveUrl, fetchImpl = fetch, log = console.log }) {
  const publicKey = publicKeyOf(signingKey);
  // The bucket's name is masked in CI logs; this says which channel a run signed for.
  log(`signing with ${publicKey}`);

  // A one-section build leaves the other sections' folders absent, which is not an error there.
  const packs = onlyPresent ? allPacks.filter((p) => existsSync(join(distDir, p.folder))) : allPacks;
  if (onlyPresent && packs.length === 0) throw new Error("nothing in dist/ to publish: build a pack first");

  // Every folder and every requirement is checked before anything is read from or sent to R2.
  for (const { folder, section } of packs) {
    const build = `${section}-package-audio`;
    if (!PACK_ID.test(folder)) throw new Error(`${folder} is not a pack id the manager accepts`);
    if (!existsSync(join(distDir, folder))) throw new Error(`dist/${folder} is missing: build it first (make ${build})`);
    // The packagers leave dist/<folder>/ beside the zip; a folder older than a zip is a stale build.
    const toc = join(distDir, folder, `${folder}.toc`);
    if (!existsSync(toc)) throw new Error(`dist/${folder} has no ${folder}.toc: the build did not finish`);
    const tocMs = statSync(toc).mtimeMs;
    const newer = readdirSync(distDir).some((n) => n.startsWith(`${folder}-`) && n.endsWith(".zip") && statSync(join(distDir, n)).mtimeMs > tocMs);
    if (newer) throw new Error(`dist/${folder} is older than its zip: rebuild it (make ${build})`);
    if (compareVersions(minSpoken[section], latestSpoken) > 0) {
      throw new Error(`${folder} needs Spoken ${minSpoken[section]}, but the latest release is ${latestSpoken}`);
    }
  }

  const current = await readSigned(store, "index.json", publicKey);
  const live = current?.value.packs ?? {};
  const known = new Set();
  const changes = [];
  const archived = new Map();
  for (const { folder, section } of packs) {
    log(`${folder}: hashing`);
    const files = await hashFolder(join(distDir, folder), cache);
    await resolvePointers(join(distDir, folder), files, archived);
    if (archived.size > 0 && !archiveUrl) throw new Error(`dist/${folder} holds clip pointers: set SPOKEN_ARCHIVE_URL`);
    // Windows and macOS fold case, so paths differing only in case would be one file there.
    const dup = caseDuplicate(files);
    if (dup) throw new Error(`${folder} lists ${dup} twice, differing only in case`);
    const requires = { Spoken: `>=${minSpoken[section]}` };
    let before = [];
    const entry = live[folder];
    if (entry) {
      const m = await readSigned(store, `packs/${folder}/${entry.rev}.json`, publicKey);
      if (!m || sha256Text(m.signed) !== entry.manifestSha256) throw new Error(`packs/${folder}/${entry.rev}.json does not match the index`);
      before = m.value.files;
      for (const f of before) known.add(f.sha256);
    }
    const diff = diffFiles(before, files);
    if (diff.same && entry?.requires.Spoken === requires.Spoken) {
      log(`${folder}: unchanged`);
      continue;
    }
    log(`${folder}: +${diff.added} ~${diff.changed} -${diff.removed}`);
    if (!allowRemovals && diff.removed > MAX_REMOVED_FILES && diff.removed > before.length * MAX_REMOVED_SHARE) {
      throw new Error(`${folder} would lose ${diff.removed} of its ${before.length} files: check the build, or allow it with --allow-removals`);
    }
    changes.push({ folder, files, requires });
  }

  const blobs = new Map();
  for (const c of changes) {
    for (const f of c.files) {
      if (!known.has(f.sha256) && !blobs.has(f.sha256)) blobs.set(f.sha256, { abs: join(distDir, c.folder, ...f.path.split("/")), size: f.size });
    }
  }
  const bytes = [...blobs.values()].reduce((n, b) => n + b.size, 0);
  log(`${blobs.size} new blobs, ${bytes} bytes${dryRun ? " (dry run: nothing sent)" : ""}`);
  const result = { changed: changes.map((c) => c.folder), blobs: blobs.size, bytes, rev: null };
  if (dryRun || changes.length === 0) return result;

  let done = 0;
  await eachLimit([...blobs], 16, async ([sha, b]) => {
    if (!(await store.head(`blobs/${sha}`))) {
      // A blob under an immutable, year-cached key cannot be corrected, so its bytes are checked
      // against the key first (a stale hash-cache entry would otherwise store the wrong bytes).
      const pointer = archived.get(sha);
      const bytes = pointer ? await archivedBytes(pointer, archiveUrl, fetchImpl) : await readFile(b.abs);
      if (sha256Text(bytes) !== sha) {
        throw new Error(`${b.abs} changed while publishing; run it again`);
      }
      await store.put(`blobs/${sha}`, bytes, { contentType: "application/octet-stream", cacheControl: IMMUTABLE });
    }
    if (++done % 100 === 0) log(`  ${done}/${blobs.size} blobs`);
  });
  log(`${done} blobs in place`);

  const rev = revOf(now);
  const nextPacks = { ...live };
  for (const c of changes) {
    const manifest = buildManifest({ packId: c.folder, rev, requires: c.requires, files: c.files });
    const sealed = sealJson(manifest, signingKey);
    // If-None-Match: a manifest is immutable and cached for a year, so a second publish within the
    // same second must fail rather than replace it.
    await store.put(`packs/${c.folder}/${rev}.json`, sealed.text, { contentType: "application/json", cacheControl: IMMUTABLE, ifNoneMatch: "*" });
    nextPacks[c.folder] = { rev, manifestSha256: sha256Text(sealed.signed), fileCount: manifest.fileCount, totalSize: manifest.totalSize, requires: c.requires };
  }
  const sealedIndex = sealJson({ generatedAt: now.toISOString(), packs: nextPacks }, signingKey);
  await store.put("index.json", sealedIndex.text, {
    contentType: "application/json", cacheControl: INDEX_CACHE,
    ...(current ? { ifMatch: current.etag } : { ifNoneMatch: "*" }),
  });
  log(`index.json now at ${rev} for ${result.changed.join(", ")}`);
  return { ...result, rev };
}
