// One publish of the manager channel: what dist/ holds now, against what the bucket says is live.
// Blobs, then manifests, then the indexes; the index writes are the only ones players see, and
// they are conditional, so two publishes racing cannot both win. Spec:
// docs/superpowers/specs/2026-10-18-manager-delta-packs-design.md
//
// TWO INDEXES. index-v2.json is the channel's record: every pack, each with its language, section,
// quests side and team, and the names of the languages it lists (docs/platform/TEAMS.md,
// *Releases*). index.json is written from it in the same publish with only the ids an older
// Manager accepts (LEGACY_PACK_ID), in the shape it has always had: that Manager rejects the whole
// index when one entry fails its check. Spoken's own zips (`addons`) are publish-addon.mjs's,
// which writes index.json, so they are read from there and written to both.
//
// STAGING. A release of a team that is not official stages: publish({ stage: true }) uploads
// blobs and manifests and writes neither index. promote() lists what it staged once a site owner
// approves it, and delist() takes a pack out of both indexes.
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readPointer } from "../lib/clip-pointer.mjs";
import { archiveBase, fetchRetrying } from "../lib/download.mjs";
import { describeFolder, LEGACY_PACK_ID, PACK_ID } from "../lib/packs.mjs";
import { buildManifest, caseDuplicate, diffFiles, hashFolder, revOf } from "./manifest.mjs";
import { bumpVersion, tocVersion, withTocVersion } from "./pack-version.mjs";
import { openJson, publicKeyOf, sealJson, sha256Text } from "./sign.mjs";
import { ConflictError } from "./store.mjs";

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

const V2_FIELDS = ["lang", "section", "pack", "team"];

/** What index-v2.json says of a pack beyond index.json's entry. No team is a page pack's. */
function packFields({ folder, lang, section, pack, team }) {
  const named = describeFolder(folder);
  return {
    lang: lang ?? named?.lang ?? null,
    section: section ?? named?.section ?? null,
    pack: pack ?? named?.pack ?? null,
    team: team ? { slug: team.slug, name: team.name, official: team.official } : null,
  };
}

/** index-v2.json as index.json would have been, for the first publish after it came in. */
function seedV2(legacy) {
  const packs = Object.fromEntries(
    Object.entries(legacy?.packs ?? {}).map(([folder, entry]) => [folder, { ...entry, ...packFields({ folder }) }]),
  );
  return { ...legacy, packs, languages: {} };
}

/** index.json's packs: the ids an older Manager accepts, in its shape. */
function legacyPacks(packs) {
  return Object.fromEntries(
    Object.entries(packs)
      .filter(([folder]) => LEGACY_PACK_ID.test(folder))
      .map(([folder, entry]) => [folder, Object.fromEntries(Object.entries(entry).filter(([key]) => !V2_FIELDS.includes(key)))]),
  );
}

// Key order aside, so an index rewritten from the other compares equal.
const canonical = (value) =>
  JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

export async function readSigned(store, key, publicKey) {
  const o = await store.get(key);
  if (!o) return null;
  return { ...openJson(o.body.toString("utf8"), publicKey), etag: o.etag };
}

/** An index entry's manifest, when it is on the channel and is the one the entry names by its sha; else null. */
export async function readEntryManifest(store, folder, entry, publicKey) {
  const manifest = await readSigned(store, `packs/${folder}/${entry.rev}.json`, publicKey);
  return manifest && sha256Text(manifest.signed) === entry.manifestSha256 ? manifest : null;
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

async function liveVersion(store, folder, files) {
  const toc = files.find((f) => f.path === `${folder}.toc`);
  const blob = toc && (await store.get(`blobs/${toc.sha256}`));
  if (!blob) throw new Error(`${folder} has no .toc on the channel to read its version from`);
  return tocVersion(blob.body.toString("utf8"));
}

// The press's one version: past the highest live one, or as staged for packs with none live yet.
function nextVersion(liveVersions, stagedVersions, bump) {
  const highest = (versions) => [...versions].sort(compareVersions).at(-1);
  return liveVersions.length > 0 ? bumpVersion(highest(liveVersions), bump) : highest(stagedVersions);
}

// With `bump`, a changed pack gets a new version in its .toc, and the version alone never counts as a change.
// `packs` are { folder, section, lang, pack?, team?: { slug, name, official } }: a pack with no team
// is a page pack. `languages` are { code, name, native }, named in index-v2.json for the packs it lists.
// With `stage`, it uploads the blobs and manifests and writes no index: it returns `staged`, the
// entries promote() lists once a site owner approves them (docs/platform/TEAMS.md, *Releases*).
export async function publish({ store, packs: allPacks, languages = [], distDir, signingKey, minSpoken, latestSpoken, cache, now = new Date(), dryRun = false, allowRemovals = false, onlyPresent = false, bump = null, stage = false, archiveUrl, fetchImpl = fetch, log = console.log }) {
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

  const { legacy, current, record, addons } = await readIndexes(store, publicKey);
  const live = record.packs ?? {};
  const known = new Set();
  const changes = [];
  const archived = new Map();
  const liveVersions = [];
  const stagedVersions = [];
  // Packs whose files are as live but whose team or language index-v2.json says otherwise: their
  // entries are rewritten at the rev they have, with no manifest.
  const retagged = {};
  for (const given of packs) {
    const { folder, section } = given;
    const requires = { Spoken: `>=${minSpoken[section]}` };
    let before = [];
    const entry = live[folder];
    if (entry) {
      const m = await readEntryManifest(store, folder, entry, publicKey);
      if (!m) throw new Error(`packs/${folder}/${entry.rev}.json does not match the index`);
      before = m.value.files;
      for (const f of before) known.add(f.sha256);
    }
    const tocPath = join(distDir, folder, `${folder}.toc`);
    if (bump) {
      const toc = await readFile(tocPath, "utf8");
      stagedVersions.push(tocVersion(toc));
      if (entry) {
        const version = await liveVersion(store, folder, before);
        liveVersions.push(version);
        await writeFile(tocPath, withTocVersion(toc, version));
      }
    }
    log(`${folder}: hashing`);
    const files = await hashFolder(join(distDir, folder), cache);
    await resolvePointers(join(distDir, folder), files, archived);
    if (archived.size > 0 && !archiveUrl) throw new Error(`dist/${folder} holds clip pointers: set SPOKEN_ARCHIVE_URL`);
    // Windows and macOS fold case, so paths differing only in case would be one file there.
    const dup = caseDuplicate(files);
    if (dup) throw new Error(`${folder} lists ${dup} twice, differing only in case`);
    const diff = diffFiles(before, files);
    if (diff.same && entry?.requires.Spoken === requires.Spoken) {
      const fields = packFields(given);
      if (V2_FIELDS.some((key) => canonical(entry[key] ?? null) !== canonical(fields[key]))) {
        retagged[folder] = { ...entry, ...fields };
        log(`${folder}: unchanged files, new metadata`);
      } else {
        log(`${folder}: unchanged`);
      }
      continue;
    }
    log(`${folder}: +${diff.added} ~${diff.changed} -${diff.removed}`);
    if (!allowRemovals && diff.removed > MAX_REMOVED_FILES && diff.removed > before.length * MAX_REMOVED_SHARE) {
      throw new Error(`${folder} would lose ${diff.removed} of its ${before.length} files: check the build, or allow it with --allow-removals`);
    }
    changes.push({ folder, files, requires });
  }

  const version = bump && changes.length > 0 ? nextVersion(liveVersions, stagedVersions, bump) : null;
  if (version) {
    for (const { folder, files } of changes) {
      const tocPath = join(distDir, folder, `${folder}.toc`);
      const toc = withTocVersion(await readFile(tocPath, "utf8"), version);
      await writeFile(tocPath, toc);
      const file = files.find((f) => f.path === `${folder}.toc`);
      file.sha256 = sha256Text(toc);
      file.size = Buffer.byteLength(toc);
      log(`${folder}: version ${version}`);
    }
  }

  const blobs = new Map();
  for (const c of changes) {
    for (const f of c.files) {
      if (!known.has(f.sha256) && !blobs.has(f.sha256)) blobs.set(f.sha256, { abs: join(distDir, c.folder, ...f.path.split("/")), size: f.size });
    }
  }
  const bytes = [...blobs.values()].reduce((n, b) => n + b.size, 0);
  log(`${blobs.size} new blobs, ${bytes} bytes${dryRun ? " (dry run: nothing sent)" : ""}`);
  const result = { changed: changes.map((c) => c.folder), blobs: blobs.size, bytes, rev: null, version };
  // A publish that failed between the two writes left index.json behind; with nothing new, this
  // one still brings it up to date. A staged publish writes no index, so it has none to bring up to date.
  const behind = !stage && (!current || canonical(legacyPacks(live)) !== canonical(legacy?.value.packs ?? {})
    || canonical(record.addons ?? null) !== canonical(addons ?? null));
  const named = Object.fromEntries(languages.map(({ code, name, native }) => [code, { code, name, native }]));
  // Files unchanged, but a team renamed or made official, or a language renamed.
  const relabelled = Object.keys(retagged).length > 0
    || canonical(listedLanguages({ ...live, ...retagged }, record, named)) !== canonical(record.languages ?? {});
  if (dryRun || (changes.length === 0 && !behind && !relabelled)) return stage ? { ...result, staged: { version, packs: {}, languages: {} } } : result;

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

  const rev = changes.length > 0 ? revOf(now) : null;
  const entries = { ...retagged };
  const given = new Map(packs.map((p) => [p.folder, p]));
  for (const c of changes) {
    const manifest = buildManifest({ packId: c.folder, rev, requires: c.requires, files: c.files });
    const sealed = sealJson(manifest, signingKey);
    // If-None-Match: a manifest is immutable and cached for a year, so a second publish within the
    // same second must fail rather than replace it.
    await store.put(`packs/${c.folder}/${rev}.json`, sealed.text, { contentType: "application/json", cacheControl: IMMUTABLE, ifNoneMatch: "*" });
    entries[c.folder] = {
      rev, manifestSha256: sha256Text(sealed.signed), fileCount: manifest.fileCount, totalSize: manifest.totalSize, requires: c.requires,
      ...packFields(given.get(c.folder)),
    };
  }
  if (stage) {
    // What promote() lists once a site owner approves it, with the rev each was staged over.
    const staged = Object.fromEntries(
      Object.entries(entries).map(([folder, entry]) => [folder, { ...entry, baseRev: live[folder]?.rev ?? null }]),
    );
    const stagedLanguages = Object.fromEntries(Object.entries(named).filter(([code]) => Object.values(staged).some((e) => e.lang === code)));
    const folders = Object.keys(staged);
    log(folders.length > 0 ? `staged ${rev ?? "new metadata"} for ${folders.join(", ")}; no index changed` : "nothing to stage");
    return { ...result, rev, staged: { version, packs: staged, languages: stagedLanguages } };
  }
  await writeIndexes({ store, signingKey, now, read: { legacy, current, record, addons }, packs: { ...live, ...entries }, languages: named });
  log(rev ? `index.json now at ${rev} for ${result.changed.join(", ")}` : "the indexes brought up to date");
  return { ...result, rev };
}

/** promote's and delist's start: the channel they sign for, said, and both indexes as they stand. */
async function openChannel(store, signingKey, log) {
  const publicKey = publicKeyOf(signingKey);
  log(`signing with ${publicKey}`);
  return { publicKey, read: await readIndexes(store, publicKey) };
}

/** Both indexes as they stand, index-v2.json seeded from index.json where it is missing. */
export async function readIndexes(store, publicKey) {
  const [legacy, current] = await Promise.all([
    readSigned(store, "index.json", publicKey),
    readSigned(store, "index-v2.json", publicKey),
  ]);
  const record = current?.value ?? seedV2(legacy?.value);
  return { legacy, current, record, addons: legacy?.value.addons ?? record.addons };
}

/** index-v2.json's languages: the record's, with `languages` over them, kept while a pack lists them. */
function listedLanguages(packs, record, languages) {
  const listed = new Set(Object.values(packs).map((entry) => entry.lang));
  const named = { ...record.languages, ...languages };
  return Object.fromEntries(Object.entries(named).filter(([code]) => listed.has(code)));
}

/**
 * index-v2.json with `packs`, then index.json from it; each write conditional on what was read, so
 * two writers racing cannot both win. The languages named are those `languages` adds to the
 * record's, kept only while a pack lists them.
 */
export async function writeIndexes({ store, signingKey, now, read: { legacy, current, record, addons }, packs, languages = {} }) {
  const nextLanguages = listedLanguages(packs, record, languages);
  const generatedAt = now.toISOString();
  const indexOpts = (was) => ({
    contentType: "application/json", cacheControl: INDEX_CACHE,
    ...(was ? { ifMatch: was.etag } : { ifNoneMatch: "*" }),
  });
  // The spread keeps whatever else each index holds; Spoken's own zips are index.json's.
  const v2 = { ...record, generatedAt, packs, addons, languages: nextLanguages };
  await store.put("index-v2.json", sealJson(v2, signingKey).text, indexOpts(current));
  try {
    const old = { ...legacy?.value, generatedAt, packs: legacyPacks(packs), addons };
    await store.put("index.json", sealJson(old, signingKey).text, indexOpts(legacy));
  } catch (err) {
    // Lost to another write, which the run-again message covers: the next publish catches index.json up.
    if (err instanceof ConflictError) throw err;
    throw new Error(`index.json is behind index-v2.json until the next publish rewrites it: ${err.message}`, { cause: err });
  }
}

/**
 * Lists a staged release, as publish({ stage: true }) returned it, in both indexes. Refuses a pack
 * whose live rev is not the one it was staged over, since listing it would undo a newer version,
 * and one whose manifest is not on the channel as staged. Nothing is written unless every pack passes.
 */
export async function promote({ store, signingKey, staged, now = new Date(), log = console.log }) {
  const { publicKey, read } = await openChannel(store, signingKey, log);
  const live = read.record.packs ?? {};
  const entries = {};
  for (const [folder, { baseRev = null, ...entry }] of Object.entries(staged.packs ?? {})) {
    if (!PACK_ID.test(folder)) throw new Error(`${folder} is not a pack id the manager accepts`);
    if ((live[folder]?.rev ?? null) !== baseRev) {
      throw new Error(`${folder} changed on the channel since it was staged: ask ${entry.team?.name ?? entry.team?.slug ?? "its team"} to release again`);
    }
    if (!(await readEntryManifest(store, folder, entry, publicKey))) {
      throw new Error(`${folder} has no manifest packs/${folder}/${entry.rev}.json on the channel as it was staged`);
    }
    entries[folder] = entry;
  }
  const promoted = Object.keys(entries);
  if (promoted.length === 0) {
    log("nothing staged to promote");
    return { promoted };
  }
  await writeIndexes({ store, signingKey, now, read, packs: { ...live, ...entries }, languages: staged.languages ?? {} });
  log(`index-v2.json now lists ${promoted.join(", ")}`);
  return { promoted };
}

/** Takes `folders` out of both indexes. Their manifests and blobs stay, as nothing deletes them. */
export async function delist({ store, signingKey, folders, now = new Date(), log = console.log }) {
  const { read } = await openChannel(store, signingKey, log);
  const packs = { ...(read.record.packs ?? {}) };
  const delisted = [];
  for (const folder of folders) {
    if (!packs[folder]) {
      log(`${folder} is not listed: nothing to take out`);
      continue;
    }
    delete packs[folder];
    delisted.push(folder);
  }
  if (delisted.length > 0) await writeIndexes({ store, signingKey, now, read, packs });
  return { delisted };
}
