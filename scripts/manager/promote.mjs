#!/usr/bin/env node
// Lists a staged release on the Manager channel once a site owner approves it: the entries
// `release.mjs --stage` wrote, which the site hands over as a file.
//
//   node scripts/manager/promote.mjs <staged.json>
//
// The keys come as for cli.mjs. The last line says what came of it: `==> promoted <version>: <folders>`.
import { readFile } from "node:fs/promises";

import { loadEnv } from "../../pipelines/lib/env.mjs";
import { errorText, promoteFromEnv } from "./channel.mjs";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("usage: promote.mjs <staged.json>");
  process.exit(2);
}

try {
  await loadEnv();
  const staged = JSON.parse(await readFile(input, "utf8"));
  const { promoted } = await promoteFromEnv({ staged });
  const version = Object.values(staged.packs ?? {}).find((entry) => entry.version)?.version ?? "";
  console.log(`==> promoted ${version || "(no version)"}: ${promoted.join(", ")}`);
} catch (error) {
  console.error(errorText(error));
  process.exit(1);
}
