// Compares each pack of one language, as the Spoken Manager installed it, with the newest approved
// file on its CurseForge project. Reads only the zip's central directory (HTTP range requests),
// never the whole zip, and matches files by path, size and CRC-32.
//
//   node check.mjs --lang <xxXX> [--json]
//
// Settings come from ~/.claude/spoken/<lang>/config.json (see config.mjs), the packs and their
// CurseForge projects from publishers/ in this repository. Writes a changelog per pack whose
// content differs, for spoken-release.sh --changelog. Uploads nothing.
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { loadConfig, packs, metaPackage, SKILL, RELEASE_SH } from "./config.mjs";

const UA = { "User-Agent": "Mozilla/5.0" };

async function newestFile(project) {
  const url = `https://www.curseforge.com/api/v1/mods/${project}/files?pageIndex=0&pageSize=5&sort=dateCreated&sortDescending=true&removeAlphas=false`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`CurseForge file list for ${project}: HTTP ${res.status}`);
  const { data } = await res.json();
  return data[0] ?? null;
}

const cdnUrl = (f) => `https://mediafilez.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${encodeURIComponent(f.fileName)}`;

async function range(url, from, to) {
  const res = await fetch(url, { headers: { ...UA, Range: `bytes=${from}-${to}` } });
  if (res.status !== 206) throw new Error(`range request on ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// path -> { size, crc } from the zip's central directory, zip64 included.
async function remoteEntries(file) {
  const url = cdnUrl(file), len = file.fileLength;
  const tail = await range(url, Math.max(0, len - 65558), len - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error(`no end of central directory in ${file.fileName}`);
  let cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const z64 = await range(url, Number(tail.readBigUInt64LE(loc + 8)), Number(tail.readBigUInt64LE(loc + 8)) + 55);
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const out = new Map();
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const crc = cd.readUInt32LE(p + 16);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    if (size === 0xffffffff) {
      for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen;) {
        const id = cd.readUInt16LE(e), n = cd.readUInt16LE(e + 2);
        if (id === 1) { size = Number(cd.readBigUInt64LE(e + 4)); break; }
        e += 4 + n;
      }
    }
    if (!name.endsWith("/")) out.set(name.replace(/^[^/]+\//, ""), { size, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function fileCrc(path) {
  const fd = openSync(path, "r"), buf = Buffer.allocUnsafe(1 << 20);
  let crc = 0, n;
  while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) crc = crc32(buf.subarray(0, n), crc);
  closeSync(fd);
  return crc >>> 0;
}

function localEntries(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name !== ".DS_Store") out.set(relative(root, full).replace(/\\/g, "/"), { size: statSync(full).size, full });
    }
  };
  walk(root);
  return out;
}

const isClip = (p) => /\.(ogg|mp3|wav)$/i.test(p);

async function check(cfg, [folder, project, name]) {
  const row = { folder, project, name };
  const toc = join(cfg.addonsDir, folder, `${folder}.toc`);
  if (!existsSync(toc)) return { ...row, error: `not installed in ${cfg.addonsDir}` };
  row.localVersion = (readFileSync(toc, "utf8").match(/^## Version:\s*(\S+)/m) ?? [])[1] ?? null;
  if (!row.localVersion) return { ...row, error: `${folder}.toc has no ## Version` };
  const file = await newestFile(project);
  if (!file) return { ...row, error: "no approved file on CurseForge yet" };
  row.cfVersion = file.displayName.replace(/^\S+\s+/, "");
  row.cfFile = file.id;
  row.cfDate = file.dateCreated;
  row.hoursSince = Math.round((Date.now() - Date.parse(file.dateCreated)) / 36e5);
  row.downloads = file.totalDownloads;
  const remote = await remoteEntries(file), local = localEntries(join(cfg.addonsDir, folder));
  const added = [], changed = [], removed = [];
  for (const [path, l] of local) {
    const r = remote.get(path);
    if (!r) added.push(path);
    else if (r.size !== l.size || r.crc !== fileCrc(l.full)) changed.push(path);
  }
  for (const path of remote.keys()) if (!local.has(path)) removed.push(path);
  const clips = (list) => list.filter(isClip).length;
  Object.assign(row, {
    clipsTotal: [...local.keys()].filter(isClip).length,
    clipsAdded: clips(added), clipsChanged: clips(changed), clipsRemoved: clips(removed),
    otherChanged: added.length + changed.length + removed.length - clips(added) - clips(changed) - clips(removed),
    localMB: Math.round([...local.values()].reduce((s, l) => s + l.size, 0) / 1e6),
  });
  if (added.length + changed.length + removed.length > 0) {
    const notesDir = `${cfg.workDir}/notes`;
    mkdirSync(notesDir, { recursive: true });
    row.notes = `${notesDir}/${folder}-${row.localVersion}.md`;
    const parts = [
      row.clipsAdded && `${row.clipsAdded} new`,
      row.clipsChanged && `${row.clipsChanged} re-voiced`,
      row.clipsRemoved && `${row.clipsRemoved} removed`,
    ].filter(Boolean);
    writeFileSync(row.notes, `${name} ${row.localVersion}\n\n- ${parts.length ? `${parts.join(", ")} voice lines` : "Data updates"} since ${row.cfVersion}.\n`);
  }
  return row;
}

const newer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

// A release is worth it when enough clips differ: every upload is a full zip that every player
// re-downloads, and CurseForge moderation asks for restraint.
function verdict(cfg, r) {
  if (r.error) return { verdict: "error", reason: r.error };
  const clips = r.clipsAdded + r.clipsChanged + r.clipsRemoved;
  if (clips + r.otherChanged === 0) return { verdict: "current", reason: "same content as on CurseForge" };
  if (!newer(r.localVersion, r.cfVersion)) return { verdict: "blocked", reason: `content changed, but version ${r.localVersion} is not above CurseForge ${r.cfVersion}` };
  if (clips < cfg.minClips && clips < r.clipsTotal * cfg.minShare) return { verdict: "not-worth", reason: `only ${clips} clips changed` };
  if (cfg.webUpload.has(r.folder)) return { verdict: "worth", reason: `${clips} clips changed, upload on the website`,
    command: `node "${SKILL}/zip.mjs" --lang ${cfg.lang} ${r.folder} --changelog "${r.notes}"` };
  const bash = process.platform === "win32" ? `& "C:/Program Files/Git/bin/bash.exe"` : "bash";
  return { verdict: "worth", reason: `${clips} clips changed`,
    command: `${bash} "${RELEASE_SH}" --config "${cfg.releaseEnv}" --lang ${cfg.lang} --store curseforge --only ${r.folder} --changelog "${r.notes}"` };
}

export { newestFile, remoteEntries, localEntries, fileCrc };
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main().catch((e) => { console.error(e.message); process.exit(1); });
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--lang");
  if (i === -1 || !args[i + 1]) throw new Error("usage: node check.mjs --lang <xxXX> [--json]");
  const cfg = loadConfig(args[i + 1]);
  const list = packs(cfg.lang);
  if (!list.length) throw new Error(`publishers/ lists no ${cfg.lang} pack with a CurseForge project`);
  const rows = [];
  for (const pack of list) {
    let row;
    try { row = await check(cfg, pack); } catch (e) { row = { folder: pack[0], project: pack[1], name: pack[2], error: e.message }; }
    rows.push({ ...row, ...verdict(cfg, row) });
  }
  const out = { lang: cfg.lang, addonsDir: cfg.addonsDir, meta: metaPackage(cfg.lang), packs: rows };
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else for (const r of rows) console.log(r.error ? `${r.folder}: ${r.error}` :
    `${r.folder}: ${r.verdict} (${r.reason}) | local ${r.localVersion}, CF ${r.cfVersion} ${r.hoursSince} h ago | +${r.clipsAdded} ~${r.clipsChanged} -${r.clipsRemoved} of ${r.clipsTotal} clips, ${r.otherChanged} other files`);
}
