#!/usr/bin/env node
// Fetch archive objects from the public bucket into this machine's archive.
//
//   node scripts/audio/fetch-blobs.mjs <archive root> < list
//
// Reads the lines `sounds.mjs --list` and `acted.mjs --list` print, keeps the ones naming an
// object (blobs/<prefix>/<sha256>), and downloads each that is not here yet from
// SPOKEN_ARCHIVE_URL. The bucket is public and every object is named by its hash, so this
// needs no keys, and a file already here with the right name is the right file.
//
// Each download is checked against its name before it is renamed into place: a pack built
// from a truncated clip would ship it to every player.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const OBJECT = /^blobs\/(takes|recordings)\/([0-9a-f]{64})$/;
const PARALLEL = 16;

export function objectsIn(lines) {
  return lines.map((line) => OBJECT.exec(line.trim())).filter(Boolean).map(([path, prefix, sha]) => ({ path, prefix, sha }));
}

export async function fetchObjects(objects, root, base, fetchImpl = fetch) {
  const wanted = objects.filter((object) => !existsSync(join(root, object.path)));
  const queue = [...wanted];
  const failed = [];
  const worker = async () => {
    for (let object = queue.shift(); object; object = queue.shift()) {
      const target = join(root, object.path);
      try {
        const res = await fetchImpl(`${base}${object.prefix}/${object.sha}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        const got = createHash("sha256").update(data).digest("hex");
        if (got !== object.sha) throw new Error(`got bytes hashing to ${got}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(`${target}.part`, data);
        await rename(`${target}.part`, target);
      } catch (error) {
        await rm(`${target}.part`, { force: true });
        failed.push(`${object.path}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { fetched: wanted.length - failed.length, present: objects.length - wanted.length, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  const base = process.env.SPOKEN_ARCHIVE_URL;
  if (!root || !base) {
    console.error("usage: SPOKEN_ARCHIVE_URL=https://… fetch-blobs.mjs <archive root> < list");
    process.exit(2);
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const objects = objectsIn(input.split("\n"));
  const result = await fetchObjects(objects, root, base.endsWith("/") ? base : `${base}/`);
  console.log(`==> ${result.fetched} fetched, ${result.present} already here`);
  if (result.failed.length) {
    for (const line of result.failed.slice(0, 10)) console.error(`  ${line}`);
    console.error(`${result.failed.length} objects could not be fetched; a pack built now would ship silence for them`);
    process.exit(1);
  }
}
