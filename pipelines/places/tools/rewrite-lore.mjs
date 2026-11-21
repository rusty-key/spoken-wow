#!/usr/bin/env node
// Rewrites a zone's lore from the full wiki article, with Claude.
//
//   node tools/rewrite-lore.mjs --zone 1420 --variant both --dry-run
//   node tools/rewrite-lore.mjs --zone 1420 --variant a
//
// SPENDS REAL CLAUDE CREDITS. Both forms do -- unlike the voice pipeline there is
// no free dry run, because the report is the model's output. What --dry-run buys is
// that nothing is written to the corpus: it produces a markdown report and stops.
// Responses are cached on disk by tools/lore/rewrite.mjs, so re-running an
// unchanged zone with an unchanged prompt costs nothing.
//
// Deliberately not part of `make scrape`. A scrape is a thing you run without
// thinking about it; a paid rewrite of 1300 lines is not, and the two should not
// share a command.
//
// This works from the *existing corpus* rather than re-enumerating the wiki: which
// subzones exist, what they are keyed and named as, and which ones are excluded are
// all decisions tools/scrape-subzones.mjs already made. Re-deriving them here would
// be a second implementation to keep in step, and would make the report's
// before/after comparison line up only by luck.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ROOT,
  classicVariant,
  cleanExtract,
  extractFromResponse,
  fetchClassicTitleIndex,
  fetchExtract,
  fetchFullExtract,
  makeShort,
  stripClassicSuffix,
} from "./lib/wiki.mjs";
import { assembleSource, VARIANTS } from "./lib/sections.mjs";
import { DEFAULT_MODEL, MAX_CHARS, rewrite } from "./lore/rewrite.mjs";
import { isEnabled, readCurrent, readLinesFromLua, recordRewrite } from "./lore/store.mjs";
import { close } from "./voice/db.mjs";
import { loadEnvFile } from "./lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const REPORT_DIR = join(ROOT, "dist");

// Four at a time. Enough to keep a 46-line zone under a couple of minutes, low
// enough that a rate limit is somebody else's problem rather than ours.
const CONCURRENCY = 4;

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const flags = {
  zone: arg("--zone"),
  all: argv.includes("--all"),
  variant: arg("--variant") || "both",
  model: arg("--model") || DEFAULT_MODEL,
  dryRun: argv.includes("--dry-run"),
  refresh: argv.includes("--refresh"),
  verbose: argv.includes("--verbose"),
};

/** "https://warcraft.wiki.gg/wiki/Agamand_Mills" -> "Agamand Mills". */
function titleFromSource(source) {
  const slug = String(source || "").split("/wiki/")[1];
  if (!slug) return null;
  return decodeURIComponent(slug).replace(/_/g, " ");
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

//------------------------------------------------------------------------------
// Source material
//------------------------------------------------------------------------------

/**
 * The article text behind one corpus line, per variant.
 *
 * The era filter runs here, before the model sees anything: it is cheap, it is
 * already proven against this corpus, and a Cataclysm sentence that never reaches
 * the prompt cannot survive the rewrite.
 */
async function sourcesFor(line, classicIndex, variants) {
  const title = titleFromSource(line.source);
  if (!title) return { error: "no source URL on this line" };

  const mainTitle = stripClassicSuffix(title);
  let main = extractFromResponse(
    (await fetchFullExtract(mainTitle, { refresh: flags.refresh })).json,
    mainTitle,
  );

  // A handful of places exist on the wiki only under their "(Classic)" title.
  if (!main && title !== mainTitle) {
    main = extractFromResponse(
      (await fetchFullExtract(title, { refresh: flags.refresh })).json,
      title,
    );
  }
  if (!main) return { error: `no article text for ${mainTitle}` };

  let classicLead = null;
  const classicTitle = classicVariant(mainTitle, classicIndex);
  if (classicTitle && variants.includes("a")) {
    const found = extractFromResponse(
      (await fetchExtract(classicTitle, { refresh: flags.refresh })).json,
      classicTitle,
    );
    if (found) classicLead = cleanExtract(found.text).full;
  }

  const sources = {};
  for (const variant of variants) {
    const assembled = assembleSource(variant, main.text, classicLead);
    const cleaned = cleanExtract(assembled.text, { verbose: flags.verbose });
    sources[variant] = {
      text: cleaned.full,
      sections: assembled.sections,
      fallback: assembled.fallback,
      droppedByEraFilter: cleaned.droppedCount,
    };
  }
  return { title: mainTitle, classicTitle, sources };
}

//------------------------------------------------------------------------------
// Report
//------------------------------------------------------------------------------

function reportFor(zoneName, mapID, variants, rows) {
  const out = [];
  out.push(`# Lore rewrite -- ${zoneName} (${mapID})`);
  out.push("");
  out.push(`Model \`${flags.model}\`, variant(s) ${variants.join(" and ")}, ${rows.length} lines.`);
  out.push("");
  out.push("Variant **a** is the (Classic) page's lead plus the main article's lore");
  out.push("sections; variant **b** is those sections alone, with no lead. Where the wiki");
  out.push("has no (Classic) page -- which is most subzones -- **a** falls back to the main");
  out.push("article's lead, so for those lines the comparison is with-lead against");
  out.push("without-lead rather than Classic-lead against none. The fallback counts below");
  out.push("say how often that happened.");
  out.push("");

  for (const variant of variants) {
    const results = rows.map((r) => r.results[variant]).filter(Boolean);
    const flagged = results.filter((r) => r.problems.length).length;
    const inferring = results.filter((r) => r.inferred?.length).length;
    const over = results.filter((r) => r.longer).length;
    const fellBack = rows.filter((r) => r.sources?.[variant]?.fallback).length;
    const lengths = results.map((r) => r.text.length).filter(Boolean);
    const mean = lengths.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : 0;
    const sourceLengths = rows.map((r) => r.sources?.[variant]?.text.length).filter(Boolean);
    const meanSource = sourceLengths.length
      ? Math.round(sourceLengths.reduce((a, b) => a + b, 0) / sourceLengths.length)
      : 0;
    out.push(
      `- **${variant}**: ${flagged} flagged, ${over} over their steer but written, ` +
        `${inferring} using regional inference, ${fellBack} fell back to a lead, ` +
        `mean ${meanSource} chars in, mean ${mean} chars out`,
    );
  }
  out.push("");

  for (const row of rows) {
    out.push(`## ${row.line.name}`);
    out.push("");
    if (row.error) {
      out.push(`> **skipped** -- ${row.error}`);
      out.push("");
      continue;
    }
    out.push(`<${row.line.source}>`);
    out.push("");
    out.push(`### current (${row.line.full.length} chars)`);
    out.push("");
    out.push(row.line.full);
    out.push("");

    for (const variant of variants) {
      const source = row.sources[variant];
      const result = row.results[variant];
      const notes = [
        source.sections.length ? `sections: ${source.sections.join(", ")}` : "sections: none",
        source.fallback ? `fallback: ${source.fallback}` : null,
        source.droppedByEraFilter
          ? `${source.droppedByEraFilter} sentence(s) dropped by the era filter`
          : null,
      ].filter(Boolean);

      out.push(`### variant ${variant} (${result.text.length} chars, budget ${result.budget})`);
      out.push("");
      out.push(`*${notes.join(" -- ")}*`);
      out.push("");

      // The text the model was actually given: sections chosen, banners removed,
      // era filter applied, nothing rewritten. Folded away because it is several
      // times the length of everything else on the page, but present because
      // "did the model invent this" is not answerable without it.
      out.push(`<details><summary>stripped parse -- what the model was given (${source.text.length} chars)</summary>`);
      out.push("");
      out.push("```");
      out.push(source.text || "(nothing)");
      out.push("```");
      out.push("");
      out.push("</details>");
      out.push("");
      if (result.problems.length) {
        out.push(...result.problems.map((p) => `> **flagged**: ${p}`));
        out.push("");
      }
      if (result.longer) {
        out.push(`> longer than its steer: ${result.longer} (still under the cap, so written)`);
        out.push("");
      }
      if (result.inferred?.length) {
        out.push(`> inferred from the region rather than this article: ${result.inferred.join(", ")}`);
        out.push("");
      }
      out.push(result.text || "*(empty)*");
      out.push("");
    }
  }

  return out.join("\n");
}

//------------------------------------------------------------------------------

async function main() {
  if (!flags.zone && !flags.all) {
    console.error("--zone is required, e.g. --zone 1420 (or --all for every zone)");
    process.exit(1);
  }
  const variants = flags.variant === "both" ? [...VARIANTS] : [flags.variant];
  for (const variant of variants) {
    if (!VARIANTS.includes(variant)) {
      console.error(`--variant must be one of ${VARIANTS.join(", ")}, or both`);
      process.exit(1);
    }
  }
  if (!flags.dryRun && variants.length > 1) {
    console.error("--variant both is a comparison; pick one variant to write to the corpus");
    process.exit(1);
  }
  if (!flags.dryRun && !isEnabled()) {
    console.error("no DATABASE_URL: a rewrite is recorded as a new version, which needs the");
    console.error("database. Use --dry-run to produce the report without writing.");
    process.exit(1);
  }

  const corpus = isEnabled() ? await readCurrent() : await readLinesFromLua();
  const byZone = new Map();
  for (const line of corpus) {
    if (!flags.all && line.mapID !== Number(flags.zone)) continue;
    if (!byZone.has(line.mapID)) byZone.set(line.mapID, []);
    byZone.get(line.mapID).push(line);
  }
  if (byZone.size === 0) {
    console.error(flags.all ? "the corpus is empty" : `no corpus lines for map ${flags.zone}`);
    process.exit(1);
  }

  const classicIndex = variants.includes("a")
    ? await fetchClassicTitleIndex({ refresh: flags.refresh })
    : new Set();

  // Each zone is recorded as it finishes rather than all of them at the end. A
  // corpus-wide run is the better part of an hour and can die in the middle of it
  // -- a rate limit, an exhausted balance, a dropped connection -- and a single
  // closing transaction turns every one of those into a run that wrote nothing.
  // Per zone, whatever finished is committed and the retry picks up from there.
  const total = { inserted: 0, promoted: 0, heldBack: 0, unchanged: 0, flagged: 0 };
  let zoneNumber = 0;
  let failure = null;

  for (const [mapID, zoneLines] of [...byZone].sort((a, b) => a[0] - b[0])) {
    zoneNumber++;
    try {
      const { entries, flagged } = await runZone({
        mapID,
        lines: zoneLines,
        variants,
        classicIndex,
        label: byZone.size > 1 ? `[${zoneNumber}/${byZone.size}] ` : "",
      });
      total.flagged += flagged;
      if (flags.dryRun) continue;

      const stats = await recordRewrite(entries);
      for (const k of ["inserted", "promoted", "heldBack", "unchanged"]) total[k] += stats[k];
      console.log(`  recorded ${stats.inserted} new version(s)`);
    } catch (err) {
      failure = { mapID, zoneNumber, err };
      break;
    }
  }

  console.log();
  if (flags.dryRun) {
    console.log(`--dry-run: nothing written. ${total.flagged} flagged across ${zoneNumber} zone(s).`);
  } else {
    console.log(
      `recorded ${total.inserted} new version(s) across ${zoneNumber} zone(s): ` +
        `${total.promoted} promoted, ${total.heldBack} held back behind a hand edit, ` +
        `${total.unchanged} unchanged, ${total.flagged} flagged and left alone`,
    );
    if (total.inserted) console.log("write the addon data files with:  make lore-export");
  }

  if (failure) {
    console.error(`\nstopped at zone ${failure.zoneNumber}/${byZone.size} (map ${failure.mapID}):`);
    console.error(`  ${failure.err.message?.split("\n")[0] ?? failure.err}`);
    console.error("\nEverything before this zone is committed, and every answer the model");
    console.error("already gave is cached -- re-run the same command to carry on from here.");
    process.exitCode = 1;
  }
}

/** One zone: fetch its articles, rewrite them, write its report. */
async function runZone({ mapID, lines, variants, classicIndex, label }) {
  lines.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "zone" ? -1 : 1,
  );
  const zoneName = lines.find((l) => l.kind === "zone")?.name || `map ${mapID}`;
  console.log(`\n${label}${zoneName} (${mapID}) -- ${lines.length} line(s)`);

  // Wiki fetches first, one at a time: cachedQuery throttles at 500 ms and being
  // polite to the wiki matters more than the minute it costs.
  const rows = [];
  for (const line of lines) {
    const source = await sourcesFor(line, classicIndex, variants);
    rows.push({ line, ...source, results: {} });
  }
  const usable = rows.filter((r) => !r.error);
  console.log(`  ${usable.length} with article text, ${rows.length - usable.length} skipped`);

  // Every source in the run, as one haystack. A capitalised word that is missing
  // from a line's own article but present in a neighbour's is regional vocabulary
  // rather than invention -- see inventedNames.
  const vocabulary = usable
    .flatMap((r) => variants.map((v) => r.sources[v].text))
    .join(" ")
    .toLowerCase();

  // Then the model, a few at a time.
  const jobs = [];
  for (const row of usable) {
    for (const variant of variants) jobs.push({ row, variant });
  }

  let done = 0;
  let cachedCount = 0;
  await mapWithConcurrency(jobs, CONCURRENCY, async ({ row, variant }) => {
    const result = await rewrite({
      name: row.line.name,
      source: row.sources[variant].text,
      variant,
      model: flags.model,
      refresh: flags.refresh,
      vocabulary,
    });
    row.results[variant] = result;
    if (result.cached) cachedCount++;
    done++;
    if (done % 10 === 0 || done === jobs.length) {
      console.log(`  rewritten ${done}/${jobs.length}`);
    }
  });

  console.log(`  ${cachedCount} from cache, ${jobs.length - cachedCount} generated`);

  const flagged = usable.flatMap((r) =>
    variants
      .filter((v) => r.results[v].problems.length)
      .map((v) => `${r.line.name} [${v}]: ${r.results[v].problems.join("; ")}`),
  );

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, `lore-rewrite-${mapID}-${variants.join("")}.md`);
  await writeFile(reportPath, reportFor(zoneName, mapID, variants, rows));

  if (flagged.length) {
    console.log(`  ${flagged.length} flagged:`);
    for (const f of flagged) console.log(`    ! ${f}`);
  }
  console.log(`  wrote ${reportPath}`);

  if (flags.dryRun) return { entries: [], flagged: flagged.length };

  // A flagged line keeps whatever it had. Everything here is versioned, so the
  // rewrite could be taken back by hand -- but a line the checks distrust is not
  // one to promote silently, and the report says which and why.
  const variant = variants[0];
  const entries = usable
    .filter((r) => r.results[variant].text && !r.results[variant].problems.length)
    .map((r) => ({
      mapID: r.line.mapID,
      kind: r.line.kind,
      key: r.line.key,
      name: r.line.name,
      full: r.results[variant].text,
      short: makeShort(r.results[variant].text),
      source: r.line.source,
      note: `rewritten from the full article, variant ${variant}, ${flags.model}`,
    }));

  const skipped = usable.length - entries.length;
  if (skipped) console.log(`  ${skipped} not written because they were flagged`);
  return { entries, flagged: flagged.length };
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(close);
