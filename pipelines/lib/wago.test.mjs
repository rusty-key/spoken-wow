import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cachePath, FOREVER_BUILD, parseCsv, wagoTable } from "./wago.mjs";

test("a quoted field keeps its commas, quotes and line breaks", () => {
  const rows = parseCsv('ID,AreaName_lang\r\n1,"Lager der ""Legashi"", Azshara"\r\n2,"Two\nlines"\n');
  assert.deepEqual(rows, [
    { ID: "1", AreaName_lang: 'Lager der "Legashi", Azshara' },
    { ID: "2", AreaName_lang: "Two\nlines" },
  ]);
});

test("a row of the wrong length is dropped", () => {
  assert.deepEqual(parseCsv("ID,Name\n1,One\n2\n"), [{ ID: "1", Name: "One" }]);
});

test("a table is fetched once per build and locale, then read from the cache", async () => {
  const cache = mkdtempSync(join(tmpdir(), "wago-"));
  const asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    return { ok: true, text: async () => "ID,Name\n1,Elwynn\n" };
  };
  const first = await wagoTable("AreaTable", { locale: "deDE", cache, fetcher });
  const second = await wagoTable("AreaTable", { locale: "deDE", cache, fetcher });
  assert.deepEqual(first, [{ ID: "1", Name: "Elwynn" }]);
  assert.deepEqual(second, first);
  assert.deepEqual(asked, [`https://wago.tools/db2/AreaTable/csv?build=${FOREVER_BUILD}&locale=deDE`]);
  // The name tools/export_compendium.py reads the same file under.
  assert.equal(readFileSync(cachePath("AreaTable", { locale: "deDE", cache }), "utf8"), "ID,Name\n1,Elwynn\n");
  assert.ok(cachePath("AreaTable", { locale: "deDE", cache }).endsWith(`AreaTable-deDE-${FOREVER_BUILD}.csv`));
});

test("a table with no rows is not cached, so the next run asks again", async () => {
  const cache = mkdtempSync(join(tmpdir(), "wago-"));
  let asked = 0;
  const fetcher = async () => {
    asked++;
    return { ok: true, text: async () => "ID,Name\n" };
  };
  assert.deepEqual(await wagoTable("Map", { locale: "itIT", cache, fetcher }), []);
  assert.equal(existsSync(cachePath("Map", { locale: "itIT", cache })), false);
  await wagoTable("Map", { locale: "itIT", cache, fetcher });
  assert.equal(asked, 2);
});
