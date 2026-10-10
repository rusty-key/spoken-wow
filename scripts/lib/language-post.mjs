#!/usr/bin/env node
// The pinned "Audio packs" post in a language's Discord channel: one message linking the latest
// GitHub release of every pack in that language, replaced whenever one of them ships.
//
//   node scripts/lib/language-post.mjs <tag>             replace the post for the tag's language
//   node scripts/lib/language-post.mjs <tag> --dry-run   print the channel and the post, send nothing
//
// #announcements gets every release on its own (announce.mjs). A language channel gets this
// instead: players there want to know which packs to install now, not a feed of each one, so
// there is only ever one post, and it is pinned.
//
// The channel is found by name, `feedback-<lang>` in lower case (feedback-de-de), so a new
// language needs a channel and no code. A language without one is skipped.
//
// A WEBHOOK CANNOT DO THIS. It can neither pin nor list pins, so finding the previous post would
// mean remembering its id somewhere between workflow runs. A bot can: the old post is whichever
// pinned message is the bot's own and starts with the heading.
//
// Environment:
//   DISCORD_BOT_TOKEN   a bot in the server with View Channel, Send Messages, Read Message
//                       History, Manage Messages and Pin Messages in the language channels
//   GITHUB_TOKEN        reads the releases
//   GITHUB_REPOSITORY   owner/repo
import { fileURLToPath } from "node:url";

import { BASE_LOCALE } from "../../pipelines/lib/locales.mjs";
import { SECTIONS, loadPacks } from "./packs.mjs";

export const HEADING = "Audio packs:";

export function channelName(lang) {
  return `feedback-${lang.replace(/([a-z])([A-Z])/, "$1-$2").toLowerCase()}`;
}

const VERSION_TAG = /\/v(\d+)\.(\d+)\.(\d+)$/;

function newer(a, b) {
  const x = a.match(VERSION_TAG).slice(1).map(Number);
  const y = b.match(VERSION_TAG).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Each release prefix's newest published release, as {tag, url}. Drafts and pre-releases are not shipped. */
export function latestReleases(releases, prefixes) {
  const latest = {};
  for (const r of releases) {
    if (r.draft || r.prerelease || !VERSION_TAG.test(r.tag_name)) continue;
    const prefix = r.tag_name.replace(VERSION_TAG, "");
    if (!prefixes.includes(prefix)) continue;
    if (!latest[prefix] || newer(r.tag_name, latest[prefix].tag)) {
      latest[prefix] = { tag: r.tag_name, url: r.html_url };
    }
  }
  return latest;
}

/** The post, sections in their usual order; a pack with no release yet is left out. */
export function postText(packs, latest) {
  const lines = [];
  for (const section of SECTIONS) {
    for (const pack of packs.filter((p) => p.section === section)) {
      const release = latest[pack.release];
      if (release) lines.push(`- ${section[0].toUpperCase()}${section.slice(1)}: ${release.url}`);
    }
  }
  return lines.length ? [HEADING, ...lines].join("\n") : null;
}

/** The tag's language and that language's GitHub packs, or {skip}. */
export function languageOf(tag, packs = loadPacks()) {
  const prefix = tag.replace(VERSION_TAG, "");
  const pack = packs.find((p) => p.release === prefix);
  if (!pack) return { skip: `${tag} is not a sound pack` };
  if (pack.lang === BASE_LOCALE) return { skip: `${tag} is English, which has no language channel` };
  return { lang: pack.lang, packs: packs.filter((p) => p.lang === pack.lang && p.github) };
}

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function allReleases(repo) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

function discord(token) {
  return async (method, path, body) => {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Discord ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
}

async function findChannel(api, name) {
  for (const guild of await api("GET", "/users/@me/guilds")) {
    const channel = (await api("GET", `/guilds/${guild.id}/channels`)).find((c) => c.name === name);
    if (channel) return channel;
  }
  return null;
}

async function replacePost(api, channelId, content) {
  const me = await api("GET", "/users/@me");
  const pins = await api("GET", `/channels/${channelId}/messages/pins?limit=50`);
  const old = pins.items.map((pin) => pin.message)
    .filter((m) => m.author.id === me.id && m.content.startsWith(HEADING));

  const posted = await api("POST", `/channels/${channelId}/messages`, {
    content,
    allowed_mentions: { parse: [] },
    flags: 4, // SUPPRESS_EMBEDS: three release previews would bury the list
  });
  // An unpinned post is invisible to the next run, which only looks at pins, so a failed pin
  // would leave a stray post behind on every attempt. A failed delete below needs no such care:
  // both posts stay pinned, and the next run removes the old one.
  try {
    await api("PUT", `/channels/${channelId}/messages/pins/${posted.id}`);
  } catch (error) {
    await api("DELETE", `/channels/${channelId}/messages/${posted.id}`);
    throw error;
  }
  for (const m of old) await api("DELETE", `/channels/${channelId}/messages/${m.id}`);

  // Pinning leaves a "pinned a message" notice in the channel, every release; the pin list
  // already says it.
  const recent = await api("GET", `/channels/${channelId}/messages?limit=10`);
  const notice = recent.find((m) => m.type === 6 && m.message_reference?.message_id === posted.id);
  if (notice) await api("DELETE", `/channels/${channelId}/messages/${notice.id}`);
  return { posted: posted.id, deleted: old.length };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tag = args.find((a) => !a.startsWith("--"));
  if (!tag) throw new Error("usage: language-post.mjs <tag> [--dry-run]");

  const target = languageOf(tag);
  if (target.skip) {
    console.log(`skipped: ${target.skip}`);
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const latest = latestReleases(await allReleases(repo), target.packs.map((p) => p.release));
  const content = postText(target.packs, latest);
  const name = channelName(target.lang);
  if (!content) {
    console.log(`skipped: no ${target.lang} pack has a release`);
    return;
  }
  if (dryRun) {
    console.log(`#${name}\n${content}`);
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");
  const api = discord(token);
  const channel = await findChannel(api, name);
  if (!channel) {
    console.log(`skipped: no #${name} channel`);
    return;
  }
  const { posted, deleted } = await replacePost(api, channel.id, content);
  console.log(`#${name}: posted and pinned ${posted}, deleted ${deleted} old post(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
