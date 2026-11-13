#!/usr/bin/env node
//
// The live CurseForge pages -> publishers/*.md
//
//   node scripts/places/import-descriptions.mjs            # show what would change
//   node scripts/places/import-descriptions.mjs --write    # write it
//
// The other direction of tools/descriptions.mjs, and the reason both exist: a
// page edited in the web form is the newer copy, and there is no upload API to
// push the repository's version back over it. So the repository has to be able to
// catch up, or it stops being where the descriptions live within a week.
//
// Read through api.cfwidget.com rather than curseforge.com, which serves the
// project page behind a challenge that a script cannot answer, and rather than
// the official Core API, which needs a separate key for a read anybody can do
// anonymously. cfwidget reports summary, categories and the rendered description
// for a numeric project id -- everything the form holds except the license.
//
// What comes back is the HTML CurseForge rendered from whatever was pasted, so a
// round trip is lossy by construction: the markdown here is regenerated from that
// HTML, not the original. Expect reflowed paragraphs and normalised emphasis; a
// diff after importing is worth reading rather than committing blind.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The monorepo root, two levels up from scripts/places/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_DIR = join(ROOT, "publishers/places");

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Inline markup only. Block elements are handled by the caller, which knows what
// kind of block it is in -- a converter that tried to do both in one pass would
// have to guess whether a <strong> inside a <td> may span lines.
function inline(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<(strong|b)>(.*?)<\/\1>/gis, "**$2**")
      .replace(/<(em|i)>(.*?)<\/\1>/gis, "*$2*")
      .replace(/<code>(.*?)<\/code>/gis, "`$1`")
      .replace(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, "[$2]($1)")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Links come back with a trailing slash CurseForge added and a rel it added too.
// Both are noise in a markdown file, and the slash makes every imported link
// differ from the one that was written by hand.
const tidyLinks = (text) => text.replace(/\]\((https?:\/\/[^)\s]+?)\/\)/g, "]($1)");

function htmlToMarkdown(html) {
  const out = [];
  // Splitting on top-level blocks rather than parsing: the description editor
  // emits a flat sequence of them, and a real parser is a dependency this repo
  // does not otherwise need.
  const blocks = html.match(
    /<h[1-6]>[\s\S]*?<\/h[1-6]>|<p>[\s\S]*?<\/p>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<pre>[\s\S]*?<\/pre>|<table>[\s\S]*?<\/table>|<blockquote>[\s\S]*?<\/blockquote>/gi,
  );
  if (!blocks) return inline(html);

  for (const block of blocks) {
    const heading = block.match(/^<h([1-6])>([\s\S]*)<\/h[1-6]>$/i);
    if (heading) {
      out.push(`${"#".repeat(Number(heading[1]))} ${inline(heading[2])}`);
      continue;
    }

    const pre = block.match(/^<pre>\s*(?:<code>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>$/i);
    if (pre) {
      out.push("```\n" + decodeEntities(pre[1]).replace(/\s+$/, "") + "\n```");
      continue;
    }

    const list = block.match(/^<(ul|ol)>([\s\S]*)<\/\1>$/i);
    if (list) {
      const ordered = list[1].toLowerCase() === "ol";
      const items = [...list[2].matchAll(/<li>([\s\S]*?)<\/li>/gi)];
      out.push(
        items
          .map((m, i) => `${ordered ? `${i + 1}.` : "-"} ${inline(m[1])}`)
          .join("\n"),
      );
      continue;
    }

    if (/^<table>/i.test(block)) {
      const rows = [...block.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((tr) =>
        [...tr[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => inline(cell[1])),
      );
      if (rows.length === 0) continue;
      const lines = [`| ${rows[0].join(" | ")} |`, `|${rows[0].map(() => "---|").join("")}`];
      for (const row of rows.slice(1)) lines.push(`| ${row.join(" | ")} |`);
      out.push(lines.join("\n"));
      continue;
    }

    const quote = block.match(/^<blockquote>([\s\S]*)<\/blockquote>$/i);
    if (quote) {
      out.push(`> ${inline(quote[1])}`);
      continue;
    }

    const text = inline(block.replace(/^<p>|<\/p>$/gi, ""));
    if (text) out.push(text);
  }

  return tidyLinks(out.join("\n\n"));
}

// Rewrites only the frontmatter keys the site is authoritative for, leaving the
// rest of the block untouched. A regenerated frontmatter would drop the keys the
// site knows nothing about -- addonReadme, license -- which is how an import
// quietly breaks packaging.
function updateFrontmatter(text, updates) {
  const end = text.indexOf("\n---\n", 3);
  let head = text.slice(4, end);

  for (const [key, value] of Object.entries(updates)) {
    const isList = Array.isArray(value);
    const replacement = isList
      ? `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`
      : `${key}: ${value}`;
    // Matches the key and any indented list lines beneath it.
    const pattern = new RegExp(`^${key}:.*(?:\\n  - .*)*$`, "m");
    head = pattern.test(head) ? head.replace(pattern, replacement) : `${head}\n${replacement}`;
  }

  return `---\n${head}\n---\n\n`;
}

async function main() {
  const write = process.argv.includes("--write");
  const files = (await readdir(SOURCE_DIR)).filter((f) => f.endsWith(".md")).sort();
  let changed = 0;

  for (const file of files) {
    const path = join(SOURCE_DIR, file);
    const text = await readFile(path, "utf8");
    const id = text.match(/^project:\s*(\d+)$/m)?.[1];
    if (!id) {
      console.error(`${file}: no 'project' id in frontmatter, skipping`);
      continue;
    }

    const response = await fetch(`https://api.cfwidget.com/${id}`);
    if (!response.ok) {
      throw new Error(`${file}: cfwidget returned ${response.status} for project ${id}`);
    }
    const live = await response.json();

    const body = htmlToMarkdown(live.description).trim() + "\n";
    const updated =
      updateFrontmatter(text, {
        // The site stores summaries with a leading space often enough that it is
        // not worth carrying into a file that gets diffed.
        summary: live.summary.trim(),
        slug: live.urls.curseforge.split("/").pop(),
        name: live.title,
        categories: live.categories,
      }) + body;

    if (updated === text) {
      console.log(`${file}: unchanged`);
      continue;
    }

    changed++;
    console.log(`${file}: differs from the live page (project ${id})`);
    if (write) await writeFile(path, updated);
  }

  if (!write && changed) {
    console.log(`\n${changed} file(s) would change -- re-run with --write`);
  }
  if (write && changed) {
    console.log(`\nwrote ${changed} file(s). Read the diff: the markdown is regenerated`);
    console.log("from CurseForge's rendered HTML, so formatting will have shifted.");
    console.log("Then: make descriptions && make descriptions-published");
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
