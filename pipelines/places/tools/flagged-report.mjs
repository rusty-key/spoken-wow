#!/usr/bin/env node
// Splits the per-zone rewrite reports into one file per kind of failure.
//
//   node tools/flagged-report.mjs
//
// The per-zone reports in dist/ are organised by place, which is right for reading
// a zone and wrong for deciding what to do about the flags: a length overrun and an
// invented name need different fixes, and they are scattered across 49 files. This
// regroups them by reason, carrying the generated text along so the decision can be
// made from the prose rather than from a count.
//
// Reads only what the rewrite already wrote. Costs nothing and calls nothing.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "./lib/loredata.mjs";
import { ACCEPT_CHARS } from "./lore/rewrite.mjs";

const DIST = join(ROOT, "dist");

/** Every place in one zone report, with its text, source and flags. */
function parseZoneReport(text, mapID) {
  const zoneName = text.match(/^# Lore rewrite -- (.+?) \(\d+\)/m)?.[1] ?? `map ${mapID}`;
  const places = [];

  // Split on the "## Name" headings; the summary block before the first one is
  // dropped by starting at index 1.
  const parts = text.split(/^## (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].trim();
    const body = parts[i + 1];

    const url = body.match(/^<(https?:[^>]+)>$/m)?.[1] ?? null;
    const current = body.match(/### current \(\d+ chars\)\n\n([\s\S]*?)(?=\n### )/)?.[1]?.trim();
    const variant = body.match(
      /### variant a \((\d+) chars, budget (\d+)\)\n\n\*(.*?)\*\n\n([\s\S]*)$/,
    );
    if (!variant) continue;

    const [, chars, budget, notes, rest] = variant;
    const source = rest.match(/<details>[\s\S]*?```\n([\s\S]*?)\n```/)?.[1] ?? "";
    const after = rest.replace(/<details>[\s\S]*?<\/details>\n\n/, "");

    const flags = [...after.matchAll(/^> \*\*flagged\*\*: (.+)$/gm)].map((m) => m[1]);
    const longer = after.match(/^> longer than its steer: (.+)$/m)?.[1] ?? null;
    const inferred = after.match(/^> inferred from the region[^:]*: (.+)$/m)?.[1] ?? null;
    const generated = after.replace(/^>.*$/gm, "").trim();

    places.push({
      name,
      zoneName,
      mapID,
      url,
      current,
      generated,
      source,
      chars: Number(chars),
      budget: Number(budget),
      notes,
      flags,
      longer,
      inferred,
    });
  }
  return places;
}

//------------------------------------------------------------------------------
// Invented-name adjudication
//
// The check compares single capitalised words against the source, which cannot see
// two things: a name the article writes as several words ("Romeo and Juliet" ->
// "Romeo-and-Juliet"), and a compound built from a word that is there
// ("Nightmare-twisted" from "Nightmare"). Both read as inventions and are not.
//
// Re-testing here with the punctuation flattened separates those from the words the
// article genuinely never contains, which are the ones worth reading.
//------------------------------------------------------------------------------

const flatten = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function adjudicate(word, source) {
  const haystack = ` ${flatten(source)} `;
  const phrase = flatten(word);

  if (haystack.includes(` ${phrase} `)) {
    return { verdict: "artifact", why: "the article has this, written with different punctuation" };
  }
  const parts = phrase.split(" ");
  if (parts.length > 1 && parts.every((p) => haystack.includes(` ${p} `))) {
    return { verdict: "artifact", why: "a compound of words the article does use" };
  }
  const stem = parts[0].replace(/(?:s|es|rs|men)$/, "");
  if (stem.length >= 4 && haystack.includes(stem)) {
    return { verdict: "borderline", why: `a form of "${stem}", which the article does use` };
  }
  return { verdict: "invented", why: "appears nowhere in the article" };
}

//------------------------------------------------------------------------------

function block(p, { withSource = false } = {}) {
  const out = [];
  out.push(`### ${p.name} — ${p.zoneName}`);
  out.push("");
  if (p.url) out.push(`<${p.url}>`);
  out.push("");
  out.push(`*${p.chars} chars against a ${p.budget} budget. ${p.notes}*`);
  out.push("");
  for (const f of p.flags) out.push(`> **${f}**`);
  if (p.inferred) out.push(`> inferred from the region: ${p.inferred}`);
  out.push("");
  out.push("**Rewritten (not in the corpus — this line kept its original text):**");
  out.push("");
  out.push(p.generated || "*(nothing)*");
  out.push("");
  out.push(`<details><summary>the text it would have replaced (${p.current?.length ?? 0} chars)</summary>`);
  out.push("");
  out.push(p.current || "*(none)*");
  out.push("");
  out.push("</details>");
  out.push("");
  if (withSource) {
    out.push(`<details><summary>what the model was given (${p.source.length} chars)</summary>`);
    out.push("");
    out.push("```");
    out.push(p.source || "(nothing)");
    out.push("```");
    out.push("");
    out.push("</details>");
    out.push("");
  }
  return out;
}

async function main() {
  const files = (await readdir(DIST)).filter((f) => /^lore-rewrite-\d+-a\.md$/.test(f));
  const places = [];
  for (const f of files) {
    const mapID = Number(f.match(/(\d+)/)[1]);
    places.push(...parseZoneReport(await readFile(join(DIST, f), "utf8"), mapID));
  }

  const flagged = places.filter((p) => p.flags.length);
  const long = flagged.filter((p) => p.flags.some((f) => /over the \d+ limit/.test(f)));
  const named = flagged.filter((p) => p.flags.some((f) => f.startsWith("names not in any source")));
  const other = flagged.filter((p) => !long.includes(p) && !named.includes(p));

  //--- 1. long -------------------------------------------------------------
  {
    const sorted = [...long].sort((a, b) => b.chars - a.chars);
    const out = [
      `# Flagged: over the ${ACCEPT_CHARS}-character limit`,
      "",
      `${sorted.length} rewrites came back longer than the corpus accepts, so each of these`,
      "places kept its original scraped text. The prose below is what was written and",
      "withheld — read it to decide whether the limit or the rewrite should move.",
      "",
      "These are the longest articles in the corpus. Condensing plateaus on them: a model",
      "asked to shorten its own draft anchors on it and shaves words from every sentence",
      "rather than dropping an episode, so three passes still land over.",
      "",
      "| place | zone | chars |",
      "|---|---|---|",
      ...sorted.map((p) => `| ${p.name} | ${p.zoneName} | ${p.chars} |`),
      "",
      "---",
      "",
    ];
    for (const p of sorted) out.push(...block(p));
    await writeFile(join(DIST, "flagged-1-too-long.md"), out.join("\n"));
    console.log(`flagged-1-too-long.md        ${sorted.length} places`);
  }

  //--- 2. invented names ---------------------------------------------------
  {
    const rows = [];
    for (const p of named) {
      const words = p.flags
        .find((f) => f.startsWith("names not in any source"))
        .replace("names not in any source: ", "")
        .split(", ")
        .map((w) => w.trim());
      rows.push({ p, calls: words.map((w) => ({ word: w, ...adjudicate(w, p.source) })) });
    }
    const rank = { invented: 0, borderline: 1, artifact: 2 };
    rows.sort(
      (a, b) =>
        Math.min(...a.calls.map((c) => rank[c.verdict])) -
        Math.min(...b.calls.map((c) => rank[c.verdict])),
    );

    const counts = { invented: 0, borderline: 0, artifact: 0 };
    for (const r of rows) for (const c of r.calls) counts[c.verdict]++;

    const out = [
      "# Flagged: names not found in the source article",
      "",
      "The invention check compares each capitalised word in a rewrite against the",
      "article it came from. A word the article never contains is the failure worth",
      "stopping for — a model that invents a plausible warlord is worse than one that",
      "writes nothing, because nobody reviewing 1300 lines will catch it.",
      "",
      "## Conclusions",
      "",
      `Of ${counts.invented + counts.borderline + counts.artifact} flagged words across ${rows.length} places:`,
      "",
      `- **${counts.invented} genuinely absent** from the article. These are the ones to read.`,
      `- **${counts.borderline} borderline** — an inflection or plural of a word the article does use.`,
      `- **${counts.artifact} artifacts of the check itself** — the article has the name, written`,
      "  with different punctuation, or the word is a compound of words it does use.",
      "  The check works word by word, so a hyphenated compound looks like one unknown",
      "  token. Worth fixing in `inventedNames`; not worth withholding a line over.",
      "",
      "A word being absent is not automatically wrong. Naming the undead of a Forsaken",
      "settlement \"the Forsaken\" is fair inference, and the check already allows that by",
      "consulting every other article in the run. What survives to this list is a word",
      "found in *no* article in its zone.",
      "",
      "| place | zone | word | verdict | why |",
      "|---|---|---|---|---|",
      ...rows.flatMap(({ p, calls }) =>
        calls.map((c) => `| ${p.name} | ${p.zoneName} | \`${c.word}\` | **${c.verdict}** | ${c.why} |`),
      ),
      "",
      "---",
      "",
    ];
    for (const { p, calls } of rows) {
      out.push(...block(p, { withSource: true }));
      out.push(...calls.map((c) => `- \`${c.word}\` — **${c.verdict}**: ${c.why}`));
      out.push("");
    }
    await writeFile(join(DIST, "flagged-2-invented-names.md"), out.join("\n"));
    console.log(`flagged-2-invented-names.md  ${rows.length} places, ${counts.invented} genuinely invented`);
  }

  //--- 3. everything else --------------------------------------------------
  {
    const out = [
      "# Flagged: everything else",
      "",
      `${other.length} places, one per failure mode. Each kept its original text.`,
      "",
      "| place | zone | flag |",
      "|---|---|---|",
      ...other.map((p) => `| ${p.name} | ${p.zoneName} | ${p.flags.join("; ")} |`),
      "",
      "---",
      "",
    ];
    for (const p of other) out.push(...block(p, { withSource: true }));
    await writeFile(join(DIST, "flagged-3-other.md"), out.join("\n"));
    console.log(`flagged-3-other.md           ${other.length} places`);
  }

  console.log(`\n${flagged.length} flagged of ${places.length} places across ${files.length} zones`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
