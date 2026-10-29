#!/usr/bin/env node
// Validate the generated website catalog and, with --complete, require every story in every
// non-English locale. The latter is intentionally opt-in while translations are being prepared.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(join(ROOT, "apps/web/src/data/boss-lore.json"), "utf8"));
const expected = ["enUS", "deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW"];
const ids = new Set();
const errors = [];

if (JSON.stringify(catalog.locales) !== JSON.stringify(expected)) errors.push("locale list differs from the website locale list");
for (const boss of catalog.bosses ?? []) {
  const id = `${boss.map}:${boss.key}`;
  if (ids.has(id)) errors.push(`duplicate boss ${id}`);
  ids.add(id);
  if (!boss.names?.enUS) errors.push(`${id} has no English name`);
  if (!boss.stories?.enUS) errors.push(`${id} has no English story`);
  for (const locale of expected) {
    if (typeof boss.stories?.[locale] !== "string") continue;
    if (!boss.stories[locale].trim()) errors.push(`${id} has an empty ${locale} story`);
  }
}

if (!catalog.bosses?.length) errors.push("catalog has no boss stories");
if (process.argv.includes("--complete")) {
  for (const locale of expected.slice(1)) {
    const missing = catalog.bosses.filter((boss) => !boss.stories?.[locale]);
    if (missing.length) errors.push(`${locale} is missing ${missing.length} stories`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${catalog.bosses.length} boss stories valid across ${expected.length} locales`);
}
