#!/usr/bin/env node
// ONE-OFF, RUN ON THE DROPLET. Kept for the record; see README.md here and ../README.md.
// Not maintained.
//
// Copies every clip on the audio volume into the archive bucket, named by its SHA-256, and
// records the hash on its row. After it, every row the site can play has an object, and
// SPOKEN_ARCHIVE_STORE can move from dual to r2.
//
//   node backfill.mjs --dry-run      what it would copy, and what is missing
//   node backfill.mjs                copy and record
//   node backfill.mjs --verify       every row with a file has an object of the same size
//
// From the release directory's node_modules (pg, aws4fetch), with the site's own environment:
//   set -a; . /srv/spoken/shared/app.env; set +a
//   NODE_PATH=/srv/spoken/current/node_modules node backfill.mjs --dry-run
//
// SAFE TO RE-RUN. It only fills a null sha256, and an object already in the bucket is not put
// again. Recordings go first: they are the least replaceable audio there is.
//
// It never deletes or changes a file, and never changes a row's archiveFile. A row whose
// file is missing is listed and left without a hash; the site goes on answering 404 for it.
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.env.NODE_PATH ?? "/srv/spoken/current/node_modules", "x.js"));
const { Pool } = require("pg");
const { AwsClient } = require("aws4fetch");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const verify = args.has("--verify");

// The first name set wins; an older droplet config sets only the zones/books names.
const need = (...names) => {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) throw new Error(`${names[0]} is not set; source shared/app.env first`);
  return value;
};

const ROOTS = {
  quests: need("SPOKEN_QUESTS_AUDIO_HISTORY"),
  places: need("SPOKEN_PLACES_AUDIO_HISTORY", "SPOKEN_ZONES_AUDIO_HISTORY"),
  readables: need("SPOKEN_READABLES_AUDIO_HISTORY", "SPOKEN_BOOKS_AUDIO_HISTORY"),
};
const SAMPLES = need("SPOKEN_QUESTS_VOICE_SAMPLES");
const REFERENCES = need("SPOKEN_QUESTS_VOICE_REFERENCES");
const BASE_LANG = "enUS";

const db = new Pool({ connectionString: need("DATABASE_URL"), max: 4 });
const r2 = new AwsClient({
  accessKeyId: need("R2_ACCESS_KEY_ID"),
  secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});
const bucket = `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${need("SPOKEN_ARCHIVE_BUCKET")}`;

const sha256Of = (data) => createHash("sha256").update(data).digest("hex");

async function head(key) {
  const res = await r2.fetch(`${bucket}/${key}`, { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${key}: HTTP ${res.status}`);
  return Number(res.headers.get("content-length"));
}

async function put(key, data, contentType) {
  if (dryRun) return;
  if ((await head(key)) === data.byteLength) return;
  const res = await r2.fetch(`${bucket}/${key}`, {
    method: "PUT",
    body: data,
    headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
  });
  if (!res.ok) throw new Error(`PUT ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// A frozen copy of apps/web/src/lib/takes/adapters.ts.
function relative(source, file) {
  return source === "quests" ? path.join(path.dirname(file), path.basename(file, ".mp3")) : file;
}
function takeFile(row) {
  const dir = relative(row.source, row.file);
  return row.lang === BASE_LANG
    ? path.join(ROOTS[row.source], dir, row.archiveFile)
    : path.join(ROOTS[row.source], row.lang, dir, row.archiveFile);
}
function recordingFile(row) {
  return path.join(ROOTS[row.source], "recorded", row.lang, relative(row.source, row.file), row.archiveFile);
}

const missing = [];
const tally = {};
const count = (what) => (tally[what] = (tally[what] ?? 0) + 1);

// Four at a time, the size of the database pool.
async function each(rows, work) {
  const queue = [...rows];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) await work(row);
    }),
  );
}

async function backfillRows(table, prefix, fileOf, typeOf) {
  const { rows } = await db.query(
    `select "id", "source", "lang", "file", "archiveFile"${table === "recording" ? `, "format"` : ""}
       from "${table}" where "sha256" is null and "archiveFile" is not null order by "id"`,
  );
  console.log(`${table}: ${rows.length} rows without a hash`);
  await each(rows, async (row) => {
    const file = fileOf(row);
    const data = await readFile(file).catch(() => null);
    if (!data) {
      missing.push(`${table} ${row.id}: ${file}`);
      return;
    }
    const sha = sha256Of(data);
    await put(`${prefix}/${sha}`, data, typeOf(row));
    if (!dryRun) await db.query(`update "${table}" set "sha256" = $2 where "id" = $1 and "sha256" is null`, [row.id, sha]);
    count(table);
  });
}

async function backfillReferences() {
  const { rows } = await db.query(
    `select "voice", "lang", "transcript", "clipHash" from "fish_reference" where "sha256" is null`,
  );
  console.log(`fish_reference: ${rows.length} rows without a hash`);
  for (const row of rows) {
    const file = path.join(REFERENCES, row.lang, `${row.voice}.mp3`);
    const data = await readFile(file).catch(() => null);
    const clip = data && createHash("sha256").update(data).update("\0").update(row.transcript).digest("hex");
    // A file that no longer matches its row is a re-cut that never finished; the site already
    // refuses to send it, so it is not copied as though it were the reference.
    if (!data || clip !== row.clipHash) {
      missing.push(`fish_reference ${row.voice} ${row.lang}: ${data ? "file does not match clipHash" : file}`);
      continue;
    }
    const sha = sha256Of(data);
    await put(`references/${sha}`, data, "audio/mpeg");
    if (!dryRun) {
      await db.query(`update "fish_reference" set "sha256" = $3 where "voice" = $1 and "lang" = $2`, [row.voice, row.lang, sha]);
    }
    count("fish_reference");
  }
}

const SAMPLE_NAME = /^[0-9a-f]{8}-[A-Za-z0-9._-]{1,64}\.(mp3|wav|m4a|mp4|ogg|flac|webm)$/;
const SAMPLE_TYPES = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm" };

async function backfillSamples() {
  const found = [];
  const walk = async (dir, clone) => {
    for (const name of await readdir(dir).catch(() => [])) {
      const full = path.join(dir, name);
      if (SAMPLE_NAME.test(name)) found.push({ clone, file: name, full });
    }
  };
  for (const entry of await readdir(SAMPLES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (/^[a-z]{2}[A-Z]{2}$/.test(entry.name)) {
      for (const slot of await readdir(path.join(SAMPLES, entry.name), { withFileTypes: true })) {
        if (slot.isDirectory()) await walk(path.join(SAMPLES, entry.name, slot.name), `${slot.name}@${entry.name}`);
      }
    } else {
      await walk(path.join(SAMPLES, entry.name), entry.name);
    }
  }
  console.log(`voice samples: ${found.length} clips on the volume`);
  await each(found, async ({ clone, file, full }) => {
    const data = await readFile(full);
    const info = await stat(full);
    const sha = sha256Of(data);
    await put(`samples/${sha}`, data, SAMPLE_TYPES[path.extname(file).slice(1)]);
    if (!dryRun) {
      await db.query(
        `insert into "voice_sample" ("clone", "file", "sha256", "bytes", "uploadedAt") values ($1, $2, $3, $4, $5)
         on conflict ("clone", "file") do nothing`,
        [clone, file, sha, data.byteLength, info.mtime],
      );
    }
    count("voice_sample");
  });
}

async function verifyAll() {
  let bad = 0;
  for (const [table, prefix] of [["take", "takes"], ["recording", "recordings"]]) {
    const { rows } = await db.query(
      `select "id", "sha256", "bytes" from "${table}" where "archiveFile" is not null order by "id"`,
    );
    await each(rows, async (row) => {
      const size = row.sha256 ? await head(`${prefix}/${row.sha256}`) : null;
      if (size === null || size !== Number(row.bytes)) {
        bad++;
        if (bad <= 20) console.error(`${table} ${row.id}: ${row.sha256 ? `object is ${size ?? "missing"}, row says ${row.bytes}` : "no hash"}`);
      }
    });
    console.log(`${table}: ${rows.length} rows checked`);
  }
  console.log(bad ? `${bad} rows are not in the bucket` : "every row with a file has its object");
  return bad === 0;
}

try {
  if (verify) {
    process.exitCode = (await verifyAll()) ? 0 : 1;
  } else {
    await backfillRows("recording", "recordings", recordingFile, (row) => (row.format === "ogg" ? "audio/ogg" : "audio/mpeg"));
    await backfillRows("take", "takes", takeFile, () => "audio/mpeg");
    await backfillReferences();
    await backfillSamples();
    console.log(`${dryRun ? "would copy" : "copied"}: ${JSON.stringify(tally)}`);
    if (missing.length) {
      console.log(`${missing.length} rows have no file on the volume:`);
      for (const line of missing) console.log(`  ${line}`);
    }
  }
} finally {
  await db.end();
}
