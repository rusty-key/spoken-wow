#!/usr/bin/env node
// Takes a team's pack off the Manager channel: its folders leave both indexes, and its manifests
// and blobs stay. The site hands the folders over as a file, `{ "folders": [...] }`.
//
//   node scripts/manager/delist.mjs <folders.json>
//
// The keys come as for cli.mjs. The last line says what came of it: `==> delisted <folders>`, or
// `==> nothing to delist` when no index listed any of them.
import { readFile } from "node:fs/promises";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { delistFromEnv, errorText } from "./channel.mjs";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("usage: delist.mjs <folders.json>");
  process.exit(2);
}

try {
  await loadEnv();
  const { folders } = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(folders) || folders.length === 0) throw new Error(`${input} names no folders`);
  const { delisted } = await delistFromEnv({ folders });
  console.log(delisted.length > 0 ? `==> delisted ${delisted.join(", ")}` : "==> nothing to delist: no index listed them");
} catch (error) {
  console.error(errorText(error));
  process.exit(1);
}
