#!/usr/bin/env node
// Merges a pull request for a UI maintainer who comments /merge on it. master is closed to
// everyone but the admin, so this runs as a GitHub App on the ruleset's bypass list, and it
// merges only the site's UI, or anything else the owner has approved at its current commit.
//
// This catches mistakes and is not a security boundary: a component runs in an admin's browser
// with their session, so the maintainer has to be someone trusted.
//
//   GITHUB_TOKEN        the App's token. It must not be the workflow's own: a merge pushed with
//                       that token would not start the deploy.
//   GITHUB_REPOSITORY   owner/name
import { fileURLToPath } from "node:url";

const OWNER = "rusty-key";
const UI_PREFIXES = ["apps/web/src/components/", "apps/web/public/"];
const UI_FILES = ["apps/web/src/app/globals.css"];
// A skipped job counts as passed, but each must be present: a missing one means CI has not run.
const CI_JOBS = ["Changed paths", "Addons (Lua)", "Quests pipeline (Python)", "Web", "Zones pipeline"];
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Components without "use client" can run on the server, where these reach data and credentials.
const SERVER_ONLY = /use server|process\.env|next\/headers|lib\/db\b|from ["']pg["']/;

export const isUiPath = (path) => UI_FILES.includes(path) || UI_PREFIXES.some((prefix) => path.startsWith(prefix));

const addedLines = (patch) => patch.split("\n").filter((line) => line.startsWith("+"));

export function scopeProblems(files) {
  const problems = [];
  for (const file of files) {
    // A move out of lib/ into components/ deletes server code, so both ends must be UI.
    for (const path of [file.previous_filename, file.filename]) {
      if (path && !isUiPath(path)) problems.push(`\`${path}\` is not UI`);
    }
    if (!CODE.test(file.filename) || file.status === "removed") continue;
    if (!file.patch) problems.push(`\`${file.filename}\` has no diff to check`);
    else if (addedLines(file.patch).some((line) => SERVER_ONLY.test(line))) {
      problems.push(`\`${file.filename}\` adds server-only code`);
    }
  }
  return problems;
}

export function ciProblems(checkRuns) {
  return CI_JOBS.flatMap((name) => {
    const run = checkRuns.find((candidate) => candidate.name === name);
    if (!run) return [`${name} has not run`];
    if (run.status !== "completed") return [`${name} is still running`];
    return ["success", "skipped"].includes(run.conclusion) ? [] : [`${name} ended in ${run.conclusion}`];
  });
}

// Reviews arrive oldest first. A plain comment changes nothing, so it does not count as a verdict.
export function ownerVerdict(reviews) {
  const verdicts = reviews.filter((review) => review.user?.login === OWNER && review.state !== "COMMENTED");
  return verdicts.at(-1) ?? null;
}

export function refusals({ pr, files, checkRuns, reviews }) {
  if (pr.state !== "open") return ["the pull request is not open"];
  if (pr.base.ref !== "master") return ["it does not target `master`"];
  if (pr.draft) return ["it is a draft"];
  const problems = ciProblems(checkRuns);
  const verdict = ownerVerdict(reviews);
  if (verdict?.state === "CHANGES_REQUESTED") problems.push(`${OWNER} requested changes`);
  const approved = verdict?.state === "APPROVED" && verdict.commit_id === pr.head.sha;
  if (approved) return problems;
  // The API stops listing files at 3000, and an unlisted file cannot be checked.
  if (files.length !== pr.changed_files) problems.push("not every changed file could be listed");
  return [...problems, ...scopeProblems(files)];
}

function github(token, repo) {
  const call = async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const all = async (path, key) => {
    const items = [];
    for (let page = 1; ; page += 1) {
      const result = await call("GET", `${path}?per_page=100&page=${page}`);
      const batch = key ? result[key] : result;
      items.push(...batch);
      console.log(`${path}: ${items.length} read`);
      if (batch.length < 100) return items;
    }
  };
  return { call, all };
}

async function main() {
  const number = process.argv[2];
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  if (!number) throw new Error("usage: ui-merge.mjs <pull request number>");
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const gh = github(token, repo);
  const reply = (body) => gh.call("POST", `/issues/${number}/comments`, { body });

  const pr = await gh.call("GET", `/pulls/${number}`);
  console.log(`#${number} at ${pr.head.sha}`);
  const problems = refusals({
    pr,
    files: await gh.all(`/pulls/${number}/files`),
    checkRuns: await gh.all(`/commits/${pr.head.sha}/check-runs`, "check_runs"),
    reviews: await gh.all(`/pulls/${number}/reviews`),
  });
  if (problems.length > 0) {
    console.log(`refused: ${problems.length} problem(s)`);
    await reply(`Not merged:\n\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    return;
  }
  try {
    // Pinned to the commit checked above, so a push made since then fails instead of merging.
    await gh.call("PUT", `/pulls/${number}/merge`, { sha: pr.head.sha, merge_method: "merge" });
  } catch (error) {
    await reply("Not merged: GitHub refused the merge. The branch may have moved or may conflict with `master`.");
    throw error;
  }
  console.log(`merged #${number}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
