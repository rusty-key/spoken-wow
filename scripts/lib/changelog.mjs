// A release's notes, read out of a changelog: the `## <version> ...` heading and the lines under
// it, up to the next `## ` heading. The store uploads and the GitHub release quote this, so the
// notes players read and the ones in the repository are the same text.
//
// And the rules AGENTS.md ("Versions and changelogs") sets for the changelog, checked.
//
//   node scripts/lib/changelog.mjs section docs/spoken/CHANGELOG.md 3.4.0
//   node scripts/lib/changelog.mjs unwrap < notes.md
//   node scripts/lib/changelog.mjs check docs/spoken/CHANGELOG.md 3.4.0 3.3.1 ...

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function linesOf(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

// A line that starts a block of its own, which is never joined to the line above it.
const BLOCK_START = /^(?:[-*+]\s|\d+[.)]\s|#|>|\||```)/;

/**
 * The notes with each paragraph and bullet on one line. The changelogs wrap at 100 columns, and
 * Discord and GitHub's release pages show every line break, so wrapped notes break mid-sentence
 * there. Blank lines, a new bullet (nested ones too), headings, quotes, tables and code fences
 * keep their lines.
 */
export function unwrap(text) {
  const out = [];
  let fenced = false;
  let joinable = false;
  for (const line of linesOf(text)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      out.push(line);
      joinable = false;
    } else if (!fenced && joinable && trimmed !== "" && !BLOCK_START.test(trimmed)) {
      out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${trimmed}`;
    } else {
      out.push(line);
      joinable = !fenced && trimmed !== "" && !/^(?:#|\|)/.test(trimmed);
    }
  }
  return out.join("\n");
}

function isHeadingFor(line, version) {
  return `${line} `.startsWith(`## ${version} `);
}

/**
 * The section for `version`. Throws when there is none, which is a release whose notes are
 * still under `## Unreleased`, or when there are two.
 */
export function section(text, version) {
  const lines = linesOf(text);
  const starts = lines.flatMap((line, i) => (isHeadingFor(line, version) ? [i] : []));
  if (starts.length === 0) throw new Error(`no "## ${version}" section`);
  if (starts.length > 1) throw new Error(`two "## ${version}" sections`);
  let end = lines.length;
  for (let i = starts[0] + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return unwrap(lines.slice(starts[0], end).join("\n").trim());
}

/** A heading of a group inside a section that names a version: `### 3.4.0`. */
const VERSION_HEADING = /^#{3,}\s+v?\d+\.\d+\.\d+/;

/** A bullet's credit: *([Name](https://github.com/Name))*. */
const CREDIT = /\*\(\[[^\]]+\]\(https:\/\/github\.com\/[^)\s]+\)\)\*/;

/**
 * What breaks the changelog's rules, as sentences; empty when nothing does.
 *
 * `released` are the versions that have shipped: the one in the .toc and the tagged ones. Each
 * needs its own section, or its notes are still under `## Unreleased` and the release went out
 * without them. `## Unreleased` comes first, each of its bullets credits its author, and no group
 * heading inside it is a version, which is what notes copied from a release leave behind.
 */
export function problems(text, released = []) {
  const lines = linesOf(text);
  const found = [];
  const headings = lines.flatMap((line, i) => (line.startsWith("## ") ? [i] : []));
  const unreleased = headings.filter((i) => lines[i].trim() === "## Unreleased");
  if (unreleased.length > 1) found.push('two "## Unreleased" sections');
  if (unreleased.length > 0 && unreleased[0] !== headings[0]) {
    found.push(`"## Unreleased" is not the first section; "${lines[headings[0]]}" is`);
  }
  if (unreleased.length > 0) {
    const start = unreleased[0];
    const end = headings.find((i) => i > start) ?? lines.length;
    let bullet = null;
    const check = () => {
      if (bullet && !CREDIT.test(bullet.text)) {
        found.push(`line ${bullet.line}: an Unreleased bullet with no credit: ${bullet.text.slice(0, 70)}`);
      }
    };
    for (let i = start + 1; i < end; i++) {
      if (VERSION_HEADING.test(lines[i])) {
        found.push(`line ${i + 1}: "${lines[i]}" is a version heading under Unreleased; a released version has its own "## " section`);
      } else if (lines[i].startsWith("- ")) {
        check();
        bullet = { line: i + 1, text: lines[i] };
      } else if (bullet && lines[i].startsWith(" ")) {
        bullet.text += ` ${lines[i].trim()}`;
      }
    }
    check();
  }
  for (const version of new Set(released)) {
    const count = lines.filter((line) => isHeadingFor(line, version)).length;
    if (count === 0) found.push(`${version} has shipped but has no "## ${version}" section`);
    if (count > 1) found.push(`two "## ${version}" sections`);
  }
  return found;
}

function main([command, ...args]) {
  if (command === "section") {
    const [file, version] = args;
    process.stdout.write(section(readFileSync(file, "utf8"), version) + "\n");
  } else if (command === "unwrap") {
    process.stdout.write(unwrap(readFileSync(0, "utf8")));
  } else if (command === "check") {
    const [file, ...released] = args;
    const found = problems(readFileSync(file, "utf8"), released);
    for (const problem of found) console.error(`${file}: ${problem}`);
    if (found.length > 0) process.exit(1);
    console.log(`${file}: in order, ${released.length} released version(s) checked`);
  } else {
    throw new Error("usage: changelog.mjs section <file> <version> | unwrap < notes | check <file> [released version...]");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
