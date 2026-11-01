#!/usr/bin/env node
//
// publishers/<project>/*.md -> the addon READMEs, and dist/descriptions*/ for pasting.
//
//   node scripts/descriptions.mjs              # check that everything is in step
//   node scripts/descriptions.mjs --write      # regenerate
//   node scripts/descriptions.mjs --drift      # pages changed since they were pasted
//   node scripts/descriptions.mjs --published  # record the current pages as pasted
//
// CurseForge has no API for project descriptions, summaries or categories --
// upload-file is the only write endpoint it offers, and metadata editing is an
// open feature request rather than a thing. So a project page is updated by
// pasting into a web form, and the only question is where the text being pasted
// comes from.
//
// It comes from here. Each file under publishers/ is one project page: the
// frontmatter is everything the form asks for besides the body, and the body is
// the description itself. Where a page names an addonReadme, the README that
// ships inside the zip is generated from the same body, so the page a player
// reads before installing and the file they get afterwards cannot say different
// things.
//
// ONE DIRECTORY PER PROJECT GROUP, each with its own published.json: publishers/
// quests/, zones/ and spoken/. They are separate because the groups are released
// separately and their hashes should not move together, and because the groups
// came from separate repositories and their page sets are still edited at
// different times.
//
// The one thing this cannot do is confirm what is actually live on the site.
// `--published` records a hash of every page, and is a claim you make after
// pasting rather than something verified here; `--drift` reports what has changed
// since, which is what scripts/*/release.sh prints before an upload.

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { forStore, parseFrontmatter } from "./lib/frontmatter.mjs";
import { loadPacks } from "./lib/packs.mjs";

// The monorepo root, two levels up from scripts/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHERS_DIR = join(ROOT, "publishers");
const OUT_DIR = join(ROOT, "dist/descriptions");

// The same bodies with their cross-links pointed at Wago, for pasting into the Wago pages.
// TWO STORES, ONE TEXT. A page links to its sibling projects, and a link is only correct on
// the store it was written for: a player reading the Wago page for Spoken Zones should be
// offered the Wago page for its sound pack, not sent to a site where their addon manager
// cannot install it. The alternative -- a second copy of every body -- is two files to edit
// and one of them silently stale, which is the failure the single source here exists to
// prevent. The slugs are identical on both stores, so this is one substitution and nothing
// per project to keep in step.
const WAGO_OUT_DIR = join(ROOT, "dist/descriptions-wago");
const CURSEFORGE_ADDON_URL = "https://www.curseforge.com/wow/addons/";
const WAGO_ADDON_URL = "https://addons.wago.io/addons/";

// Where a project that is not on Wago is offered instead. The sound packs are 280-452 MB and
// Wago's upload endpoint refuses a file that size, so their Wago projects hold no files: a
// link to one is a page a player can reach and download nothing from, which is worse than no
// link. Those slugs point at the pack's GitHub releases instead, which is where it is, and
// the query rather than a tag so the link does not go stale the next time the audio is built.
const GITHUB_RELEASES_URL = "https://github.com/rusty-key/spoken-wow/releases?q=";

// slug -> the URL the Wago copy should use, for pages whose frontmatter names a `release:`
// tag prefix. Everything else is rewritten to the Wago page of the same slug. A pack kept off
// GitHub (`github: false`, English's four split quests packs) has no releases there to find,
// so its link stays on CurseForge, the one place that has it.
function wagoUrls(pages) {
  const urls = new Map();
  for (const page of pages) {
    if (!page.meta.release) continue;
    urls.set(page.meta.slug, page.meta.github === "false"
      ? CURSEFORGE_ADDON_URL + page.meta.slug
      : GITHUB_RELEASES_URL + page.meta.release);
  }
  return urls;
}

// STORE-CONDITIONAL PROSE, for the few sentences that are not true on both stores. A block
// between `<!-- only:wago -->` and `<!-- /only -->` survives only in the Wago copy, and
// `only:curseforge` only in the CurseForge one; everything outside a block is shared, which
// is nearly all of it.
//
// It exists because the meta pack is a CurseForge mechanism: `audio-all` holds no audio and
// works by declaring the four packs as required dependencies, which CurseForge resolves per
// upload and Wago has no field for. Telling a Wago player to "take All and your manager
// fetches the rest" is telling them to install an empty folder. Link rewriting cannot fix a
// sentence, so the sentence itself is per store.
//
// Deliberately blunt: no nesting, no conditions beyond the two store names. A page that needs
// more than a paragraph of difference is two pages, and should say so by being two pages.
// Two shapes, because a block is either whole lines or part of a sentence, and getting the
// newlines wrong shows up as a blank row in the middle of a markdown table.
function forWago(body, urls) {
  return forStore(body, "wago").replace(
    new RegExp(`${CURSEFORGE_ADDON_URL}([a-z0-9-]+)`, "g"),
    (_, slug) => urls.get(slug) ?? WAGO_ADDON_URL + slug,
  );
}

const GENERATED_NOTE =
  "<!-- GENERATED from publishers/%s by scripts/descriptions.mjs. Do not edit by hand. -->";


// `wago` is not among them: a language's sound pack is on CurseForge alone, since Wago refuses
// a file its size and the page's `release:` already sends a Wago reader to GitHub instead.
// Nor is `curseforge`, for a pack released on GitHub before its CurseForge project exists.
const REQUIRED = ["slug", "name", "summary", "categories", "license"];

// CurseForge's summary field. Enforced here rather than discovered in the form,
// where the failure is a truncated sentence nobody re-reads.
const SUMMARY_LIMIT = 255;

// Every directory under publishers/ is a group of project pages. Discovered
// rather than listed, so adding a fourth addon is a directory and not an edit
// here -- and README.md files alongside the pages are skipped by the .md filter
// below only because they carry no frontmatter, so they are skipped by name.
const NOT_A_PAGE = new Set(["README.md"]);

async function loadGroups() {
  const entries = await readdir(PUBLISHERS_DIR);
  const groups = [];

  for (const name of entries.sort()) {
    const dir = join(PUBLISHERS_DIR, name);
    if (!(await stat(dir)).isDirectory()) continue;

    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".md") && !NOT_A_PAGE.has(f))
      .sort();
    const pages = [];

    for (const file of files) {
      const text = await readFile(join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(text, `${name}/${file}`);

      for (const key of REQUIRED) {
        if (meta[key] === undefined) throw new Error(`${name}/${file}: missing '${key}'`);
      }
      if (meta.summary.length > SUMMARY_LIMIT) {
        throw new Error(
          `${name}/${file}: summary is ${meta.summary.length} characters, over CurseForge's ${SUMMARY_LIMIT}`,
        );
      }
      if (meta.curseforge !== undefined && !/^\d+$/.test(meta.curseforge)) {
        throw new Error(
          `${name}/${file}: 'curseforge' should be the numeric CurseForge project id`,
        );
      }
      // Wago's ids are eight alphanumeric characters and case matters -- QN53yXKB is not
      // qn53yxkb. Checked here because the upload endpoint is /projects/<id>/version: a
      // mistyped id is a 404 in the middle of a release, or worse, somebody else's project.
      if (meta.wago !== undefined && !/^[A-Za-z0-9]{8}$/.test(meta.wago)) {
        throw new Error(
          `${name}/${file}: 'wago' should be the 8-character Wago project id, from the ` +
            `project's page in https://addons.wago.io/developers`,
        );
      }

      pages.push({ group: name, file, path: `${name}/${file}`, meta, body });
    }

    if (pages.length) groups.push({ name, dir, pages });
  }

  if (groups.length === 0) throw new Error(`no project pages found under ${PUBLISHERS_DIR}`);

  // A slug names a project, and two files claiming one would quietly overwrite
  // each other in dist/descriptions/ and share a published.json entry.
  const seen = new Map();
  for (const page of groups.flatMap((g) => g.pages)) {
    const first = seen.get(page.meta.slug);
    if (first) throw new Error(`${page.path} and ${first} both claim slug '${page.meta.slug}'`);
    seen.set(page.meta.slug, page.path);
  }

  return groups;
}

// What gets pasted into the description field, and what ships as the README.
// Identical by construction; the note only appears in the generated README, since
// an HTML comment in the form would be pasted into the page.
function readmeFor(page) {
  return `${GENERATED_NOTE.replace("%s", page.path)}\n\n${forStore(page.body, "curseforge")}`;
}

// Which descriptions have been pasted into the site, and at what content. The
// site cannot be read back -- there is no API -- so this is the only way to
// notice a description edited in the repository months ago and never pasted.
function publishedPath(group) {
  return join(group.dir, "published.json");
}

function digest(body) {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

async function loadPublished(group) {
  return JSON.parse(await readFile(publishedPath(group), "utf8").catch(() => "{}"));
}

// Slugs whose description differs from what was last recorded as pasted.
// scripts/*/release.sh prints these; --drift is how it asks.
async function reportDrift(groups) {
  let stale = 0;
  for (const group of groups) {
    const published = await loadPublished(group);
    for (const page of group.pages) {
      if (published[page.meta.slug] === digest(page.body)) continue;
      const seen = published[page.meta.slug] ? "changed since" : "never recorded as";
      console.log(`${page.meta.slug}\t${seen} pasted`);
      stale++;
    }
  }
  return stale;
}

// --group=quests limits the run to one directory under publishers/. Only --drift uses it, and
// only so that a release prints the pages that release is about: every project's pages are
// tracked here now, and a places upload listing five unpasted quests pages is noise at exactly
// the moment somebody is working through a checklist.
function groupFilter() {
  const arg = process.argv.find((a) => a.startsWith("--group="));
  return arg ? arg.slice("--group=".length) : null;
}

async function main() {
  // The pack rules (scripts/lib/packs.mjs) are checked on every run, so `make lint` fails on a
  // page that would send a pack to the wrong folder or tag.
  loadPacks();

  const write = process.argv.includes("--write");
  const only = groupFilter();
  const all = await loadGroups();
  const groups = only ? all.filter((g) => g.name === only) : all;
  if (only && groups.length === 0) throw new Error(`no such project group: publishers/${only}`);
  const pages = groups.flatMap((g) => g.pages);
  const drift = [];

  if (process.argv.includes("--drift")) {
    await reportDrift(groups);
    return;
  }

  // Says "what is in the repository now is what is on the site now". Run it
  // after pasting, not before: nothing here can verify the claim.
  if (process.argv.includes("--published")) {
    for (const group of groups) {
      const published = await loadPublished(group);
      for (const page of group.pages) published[page.meta.slug] = digest(page.body);
      await writeFile(publishedPath(group), JSON.stringify(published, null, 2) + "\n");
    }
    console.log(`recorded ${pages.length} description(s) as pasted`);
    return;
  }

  for (const page of pages) {
    const target = page.meta.addonReadme;
    if (!target) continue;

    const path = join(ROOT, target);
    const wanted = readmeFor(page);
    const current = await readFile(path, "utf8").catch(() => null);

    if (current === wanted) continue;

    if (write) {
      await writeFile(path, wanted);
      console.log(`wrote ${target}`);
    } else {
      drift.push(`${target} is out of step with publishers/${page.path}`);
    }
  }

  if (write) {
    await mkdir(OUT_DIR, { recursive: true });
    await mkdir(WAGO_OUT_DIR, { recursive: true });
    // Built from every page, not from the ones being written: --group=places still has to know
    // that spoken-audio-quests-horde is a pack, or a zones-only run would link it to a Wago
    // page holding nothing.
    const urls = wagoUrls(all.flatMap((g) => g.pages));
    for (const page of pages) {
      await writeFile(join(OUT_DIR, `${page.meta.slug}.md`), forStore(page.body, "curseforge"));
      // No Wago project, nothing to paste there.
      if (page.meta.wago === undefined) continue;
      await writeFile(join(WAGO_OUT_DIR, `${page.meta.slug}.md`), forWago(page.body, urls));
    }
    console.log(
      `wrote ${pages.length} description(s) to dist/descriptions/ and dist/descriptions-wago/`,
    );
  }

  if (drift.length) {
    console.error("FAILED -- run `make descriptions`");
    for (const line of drift) console.error(`  ${line}`);
    process.exit(1);
  }

  if (!write) {
    console.log(`OK -- ${pages.length} project pages, READMEs in step`);
    for (const group of groups) {
      for (const page of group.pages) {
        console.log(
          `     ${page.meta.slug} (${page.meta.curseforge ? `CurseForge ${page.meta.curseforge}` : "not on CurseForge yet"}, ` +
            `${page.meta.wago ? `Wago ${page.meta.wago}` : "not on Wago"}): ` +
            `summary ${page.meta.summary.length}/${SUMMARY_LIMIT} chars`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
