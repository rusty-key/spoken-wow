#!/usr/bin/env node
// Translate the English website boss-lore catalog into every supported non-English locale.
//
// The translation endpoint is used only by this explicit opt-in command. Boss and dungeon
// titles are replaced by opaque markers before translation and restored from Bosses.lua and
// Dungeons.lua afterward, so a translated story uses the same title the page displays.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOG = join(ROOT, "apps/web/src/data/boss-lore.json");
const OUT = join(ROOT, "translations/boss-lore");
const API = "https://translate.googleapis.com/translate_a/single";
const TARGETS = {
  deDE: "de",
  esES: "es",
  esMX: "es",
  frFR: "fr",
  itIT: "it",
  ptBR: "pt-BR",
  ruRU: "ru",
  koKR: "ko",
  zhCN: "zh-CN",
  zhTW: "zh-TW",
  viVN: "vi",
};
const MAX_BATCH = 3600;
const CONCURRENCY = 3;
const RETRIES = 4;

const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
await mkdir(OUT, { recursive: true });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestTranslation(input, target) {
  const url = `${API}?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(input)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return translatedText(await response.json());
}

function protect(row, locale) {
  const values = [
    [row.names?.enUS, row.names?.[locale]],
    [row.dungeons?.enUS, row.dungeons?.[locale]],
  ].filter(([english]) => english);
  let text = row.stories.enUS;
  const replacements = [];
  for (const [number, [english, translated]] of values.entries()) {
    const token = `ZXP${number}Q`;
    text = text.split(english).join(token);
    replacements.push([token, translated || english]);
  }
  return {
    text,
    restore(value) {
      let restored = value;
      for (const [token, replacement] of replacements) {
        restored = restored.split(token).join(replacement);
        // A fallback for endpoints that insert a space around an opaque marker.
        restored = restored.split(token.replace("X", " X")).join(replacement);
      }
      return restored.trim();
    },
  };
}

function batches(rows, locale) {
  const result = [];
  let current = [];
  let size = 0;
  for (const [index, row] of rows.entries()) {
    const prepared = protect(row, locale);
    const segment = `ZXA${index}Q\n${prepared.text}\nZXB${index}Q`;
    if (current.length && size + segment.length > MAX_BATCH) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push({ index, row, prepared, segment });
    size += segment.length + 2;
  }
  if (current.length) result.push(current);
  return result;
}

function translatedText(payload) {
  if (!Array.isArray(payload?.[0])) throw new Error("translation response had no segments");
  return payload[0].map((segment) => segment?.[0] ?? "").join("");
}

function extract(text, segment) {
  const start = `ZXA${segment.index}Q`;
  const end = `ZXB${segment.index}Q`;
  const begin = text.indexOf(start);
  const finish = text.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) return null;
  return segment.prepared.restore(text.slice(begin + start.length, finish));
}

async function translateBatch(batch, target) {
  const input = batch.map((segment) => segment.segment).join("\n\n");
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const output = await requestTranslation(input, target);
      const translated = batch.map((segment) => [segment.index, extract(output, segment)]);
      if (translated.every(([, text]) => text)) return translated;

      // Google occasionally translates a marker that contains a word such as "END" when
      // several stories are sent together. Smaller batches are less ambiguous, and a
      // marker-free single-story request is the final fallback.
      if (batch.length > 1) {
        const individual = [];
        for (const segment of batch) individual.push(...(await translateBatch([segment], target)));
        return individual;
      }
      const direct = await requestTranslation(batch[0].prepared.text, target);
      return [[batch[0].index, batch[0].prepared.restore(direct)]];
    } catch (error) {
      lastError = error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`translation failed for ${target}: ${lastError?.message ?? lastError}`);
}

async function translateLocale(locale, target) {
  const rows = catalog.bosses;
  const output = {};
  try {
    const existing = JSON.parse(await readFile(join(OUT, `${locale}.json`), "utf8"));
    if (!process.env.FORCE && rows.every((row) => typeof existing[`${row.map}:${row.key}`] === "string")) {
      console.log(`${locale}: already complete`);
      return;
    }
  } catch {
    // No resumable file yet.
  }
  const queue = batches(rows, locale);
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const batch = queue[next++];
      for (const [index, text] of await translateBatch(batch, target)) {
        output[`${rows[index].map}:${rows[index].key}`] = text;
      }
      process.stdout.write(`\r${locale}: ${Math.min(next, queue.length)}/${queue.length}`);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  process.stdout.write("\n");
  await writeFile(join(OUT, `${locale}.json`), `${JSON.stringify(output, null, 2)}\n`);
}

for (const [locale, target] of Object.entries(TARGETS)) {
  await translateLocale(locale, target);
}
console.log(`Translated ${catalog.bosses.length} stories into ${Object.keys(TARGETS).length} locales.`);
