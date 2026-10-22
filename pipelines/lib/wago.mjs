// The client's own tables (DB2), as wago.tools serves them per build and locale.
//
// One pinned build per client, one reader and one cache for every pipeline that reads them: the
// books' places, the zones' area seeds and alias tables, and tools/export_compendium.py, which
// reads the same cache under the same file names. A table is fetched once per build and locale
// and read from the cache after that, so an export run twice gives the same file.
//
// Moving a pin is deliberate: the area names change, so the files derived from them (the zones'
// seeds and alias tables, ForeverAreas.lua, the Compendium and Places.lua) are regenerated and
// reviewed together.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Classic Era's client, which other clients' players still run.
export const ERA_BUILD = "1.15.9.69109";
// World of Warcraft Forever's client (wago.tools' wow_classic_beta).
export const FOREVER_BUILD = "1.60.1.70338";
// Retail's, whose Adventure Guide (the Journal tables) the boss tools read.
export const RETAIL_BUILD = "12.1.5.70448";

export const CACHE = fileURLToPath(new URL("./cache/wago/", import.meta.url));

// RFC 4180 as wago.tools writes it: quoted fields that may hold commas, quotes (doubled) and line
// breaks. Rows as objects keyed by the header; a row of the wrong length is dropped.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

export function cachePath(name, { build = FOREVER_BUILD, locale = "enUS", cache = CACHE } = {}) {
  return join(cache, `${name}-${locale}-${build}.csv`);
}

/**
 * One table as an array of row objects, from the cache or else from wago.tools.
 *
 * A build with no data for a locale serves the English strings rather than failing, which is
 * why callers compare against English instead of trusting that a request for deDE returned
 * German.
 */
export async function wagoTable(name, { build = FOREVER_BUILD, locale = "enUS", cache = CACHE, fetcher = fetch } = {}) {
  const file = cachePath(name, { build, locale, cache });
  if (!existsSync(file)) {
    const url = `https://wago.tools/db2/${name}/csv?build=${build}&locale=${locale}`;
    const response = await fetcher(url, { headers: { "User-Agent": "curl/8.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    await mkdir(cache, { recursive: true });
    await writeFile(file, await response.text());
  }
  return parseCsv(await readFile(file, "utf8"));
}
