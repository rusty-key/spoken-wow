// Deletes what no recent manifest needs. Run by hand (make manager-gc), never by publish.
import { eachLimit } from "./publish.mjs";
import { openJson, publicKeyOf } from "./sign.mjs";

export const KEEP_REVS = 10;
export const KEEP_DAYS = 90;
const DAY = 86400000;
// A blob uploaded by a publish still running is not referenced yet.
const BLOB_GRACE = DAY;

export function revTime(rev) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(rev);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

export async function gc({ store, signingKey, now = new Date(), dryRun = false, log = console.log }) {
  const publicKey = publicKeyOf(signingKey);
  const idx = await store.get("index.json");
  if (!idx) {
    log("no index.json: nothing to collect");
    return { deleted: [] };
  }
  const index = openJson(idx.body.toString("utf8"), publicKey).value;

  const revsByPack = new Map();
  for (const { key } of await store.list("packs/")) {
    const m = /^packs\/([^/]+)\/(\d{8}T\d{6}Z)\.json$/.exec(key);
    if (!m) continue;
    if (!revsByPack.has(m[1])) revsByPack.set(m[1], []);
    revsByPack.get(m[1]).push(m[2]);
  }
  const keep = [];
  const drop = [];
  for (const [pack, revs] of revsByPack) {
    revs.sort().reverse();
    revs.forEach((rev, i) => {
      const recent = now - revTime(rev) < KEEP_DAYS * DAY;
      (i < KEEP_REVS || recent || index.packs[pack]?.rev === rev ? keep : drop).push(`packs/${pack}/${rev}.json`);
    });
  }

  const referenced = new Set();
  for (const key of keep) {
    const o = await store.get(key);
    for (const f of openJson(o.body.toString("utf8"), publicKey).value.files) referenced.add(f.sha256);
  }
  for (const { sha256 } of Object.values(index.addons ?? {}).flat()) referenced.add(sha256);
  const blobs = (await store.list("blobs/"))
    .filter(({ key, lastModified }) => !referenced.has(key.slice("blobs/".length)) && now - lastModified > BLOB_GRACE)
    .map(({ key }) => key);

  log(`${drop.length} old manifests, ${blobs.length} unreferenced blobs${dryRun ? " (dry run: nothing deleted)" : ""}`);
  if (!dryRun) {
    for (const key of drop) await store.delete(key);
    await eachLimit(blobs, 16, (key) => store.delete(key));
  }
  return { deleted: [...drop, ...blobs] };
}
