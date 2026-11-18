#!/usr/bin/env node
// Fetch archive objects from the public bucket into this machine's archive.
//
//   node scripts/audio/fetch-blobs.mjs <archive root> < list
//
// Takes the blobs/<prefix>/<sha256> lines of `sounds.mjs --list` and `acted.mjs --list`. The
// bucket is public and objects are named by hash, so this needs no keys and skips files already here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { archiveBase, downloadVerified, eachParallel } from "../lib/download.mjs";

const OBJECT = /^blobs\/(takes|recordings)\/([0-9a-f]{64})$/;

export function objectsIn(lines) {
  return lines.map((line) => OBJECT.exec(line.trim())).filter(Boolean).map(([path, prefix, sha]) => ({ path, prefix, sha }));
}

/**
 * With SPOKEN_ARCHIVE_TOKEN, a fetch that sends it to the site's /api/archive/ alone and follows
 * the redirect without it: the token must never reach a team's bucket.
 */
export function archiveFetch(token, fetchImpl = fetch) {
  if (!token) return fetchImpl;
  return async (url, init = {}) => {
    // Only to the site's archive route, and only encrypted or on this machine: a base pointed
    // straight at a bucket, or at plain http elsewhere, gets no token.
    const at = new URL(url);
    const local = at.hostname === "localhost" || at.hostname === "127.0.0.1" || at.hostname === "[::1]";
    if (!at.pathname.includes("/api/archive/") || (at.protocol !== "https:" && !local)) return fetchImpl(url, init);
    const first = await fetchImpl(url, { ...init, redirect: "manual", headers: { ...init.headers, authorization: `Bearer ${token}` } });
    const location = first.status >= 300 && first.status < 400 ? first.headers.get("location") : null;
    if (!location) return first;
    await first.body?.cancel();
    return fetchImpl(new URL(location, url).toString(), init);
  };
}

export async function fetchObjects(objects, root, base, fetchImpl = fetch) {
  const wanted = objects.filter((object) => !existsSync(join(root, object.path)));
  const failed = [];
  await eachParallel(wanted, async (object) => {
    try {
      await downloadVerified(`${base}${object.prefix}/${object.sha}`, object.sha, join(root, object.path), fetchImpl);
    } catch (error) {
      failed.push(`${object.path}: ${error.message}`);
    }
  });
  return { fetched: wanted.length - failed.length, present: objects.length - wanted.length, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2];
  const base = process.env.SPOKEN_ARCHIVE_URL;
  if (!root || !base) {
    console.error("usage: SPOKEN_ARCHIVE_URL=https://… fetch-blobs.mjs <archive root> < list");
    process.exit(2);
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const objects = objectsIn(input.split("\n"));
  const result = await fetchObjects(objects, root, archiveBase(base), archiveFetch(process.env.SPOKEN_ARCHIVE_TOKEN));
  console.log(`==> ${result.fetched} fetched, ${result.present} already here`);
  if (result.failed.length) {
    for (const line of result.failed.slice(0, 10)) console.error(`  ${line}`);
    console.error(`${result.failed.length} objects could not be fetched; a pack built now would ship silence for them`);
    process.exit(1);
  }
}
