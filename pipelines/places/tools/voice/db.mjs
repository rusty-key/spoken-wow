// Postgres access for the voiceline store.
//
// The only module in tools/ that needs a dependency. Everything else here -- the
// scrapers, the normaliser, the ElevenLabs client, the addon build -- stays on the
// standard library, so `node tools/voice/generate.mjs` works on a clone with nothing
// installed as long as DATABASE_URL is unset.
//
// Nothing outside store.mjs should import this. store.mjs is the seam that decides
// between Postgres and the JSON file, and a second caller reaching past it is how the
// two views drift apart.

import pg from "pg";

// The manifest's durationSec is a number and the addon's lookup table needs it to
// stay one. node-postgres returns `numeric` as a string by default, because the type
// is arbitrary-precision and JS numbers are not -- correct in general, wrong here,
// where the values are ffprobe's three decimal places. Left alone, the exported
// manifest would grow quotes around every duration and build-lookup.mjs would emit
// `len = "49.6"` into Lua.
const NUMERIC_OID = 1700;
pg.types.setTypeParser(NUMERIC_OID, (value) => (value === null ? null : Number(value)));

// bigint (int8), for "bytes". Same reasoning: the manifest stores a number, and no
// mp3 here is anywhere near 2^53.
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (value) => (value === null ? null : Number(value)));

let pool = null;

export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  // An empty string is how a caller says "use the file", e.g.
  // `DATABASE_URL= node tools/voice/generate.mjs`. Treat it as absent.
  return url && url.trim() !== "" ? url : null;
}

export function isEnabled() {
  return databaseUrl() !== null;
}

function getPool() {
  if (!pool) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

// A transaction. Used for the one operation that must not half-apply: retiring the
// live take and inserting its replacement.
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Scripts are short-lived and an open pool keeps the process alive after main()
// returns, which looks exactly like a hang.
export async function close() {
  if (pool) {
    const closing = pool.end();
    pool = null;
    await closing;
  }
}
