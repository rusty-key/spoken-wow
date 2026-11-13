// A pack folder in dist/ as the manager channel describes it: every file by its / path, with
// its sha256 and size. A path the manager refuses would hide the whole pack, so the rules match its own.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const BAD_CHARS = /[\0<>:"|?*\\\x01-\x1f]/;

// Windows treats these as devices whatever the extension: CON, CON.txt and con.ogg are all the console.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isSafePath(p) {
  if (typeof p !== "string" || p === "" || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !BAD_CHARS.test(s) && !/[. ]$/.test(s) && !RESERVED.test(s.split(".")[0]));
}

// Dotfiles (.DS_Store and the like) never ship.
export async function listFiles(root, rel = "") {
  const out = [];
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, p)));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

export function loadHashCache(file) {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
  } catch {
    return new Map();
  }
}

export function saveHashCache(file, cache) {
  writeFileSync(file, JSON.stringify(Object.fromEntries(cache)));
}

// The cache maps an absolute path to { size, mtimeMs, ctimeMs, sha256 }; a file whose size and
// times are unchanged is not read again. ctime is in the key because rsync -a and cp -p set mtime
// back on new content, and nothing can set ctime: a stale hit would ship the old clip.
export async function hashFolder(root, cache) {
  const files = [];
  for (const path of await listFiles(root)) {
    if (!isSafePath(path)) throw new Error(`${root}: unsafe file name ${path}`);
    const abs = join(root, ...path.split("/"));
    const st = await stat(abs);
    const hit = cache.get(abs);
    const same = hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs;
    const sha256 = same ? hit.sha256 : await sha256File(abs);
    cache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, sha256 });
    files.push({ path, sha256, size: st.size });
  }
  return files;
}

// The first path that repeats an earlier one apart from case, or null.
export function caseDuplicate(files) {
  const seen = new Set();
  for (const f of files) {
    const key = f.path.toLowerCase();
    if (seen.has(key)) return f.path;
    seen.add(key);
  }
  return null;
}

export function buildManifest({ packId, rev, requires, files }) {
  return { packId, rev, requires, fileCount: files.length, totalSize: files.reduce((n, f) => n + f.size, 0), files };
}

export function diffFiles(before, after) {
  const old = new Map(before.map((f) => [f.path, f.sha256]));
  const now = new Map(after.map((f) => [f.path, f.sha256]));
  let added = 0, changed = 0, removed = 0;
  for (const [p, sha] of now) {
    if (!old.has(p)) added++;
    else if (old.get(p) !== sha) changed++;
  }
  for (const p of old.keys()) if (!now.has(p)) removed++;
  return { added, changed, removed, same: added + changed + removed === 0 };
}

export function revOf(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
