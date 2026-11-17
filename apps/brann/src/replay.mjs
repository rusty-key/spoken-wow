#!/usr/bin/env node
// Replays a channel's recent messages through Brann's support rules and model call, and prints
// which he would answer and what he would say. Posts nothing, files nothing (README.md).
//
//   node apps/brann/src/replay.mjs <channel> [--limit 100] [--all]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { ROOT_ENV_PATH, parseEnv } from "../../../pipelines/lib/env.mjs";
import { isModerator } from "../../../scripts/lib/forum-issues.mjs";
import { discord, findChannel } from "../../../scripts/lib/language-post.mjs";
import { COOLDOWN, DEFAULT_MODEL, ask, beingHelped, contextFor, loadFaq, systemPrompt, worthAsking } from "./support.mjs";

// Default and Reply: what the bot looks at. Joins, pins and the like are not questions.
const SPOKEN_TYPES = [0, 19];
const CONCURRENCY = 5;

function env() {
  let file = new Map();
  try {
    file = parseEnv(readFileSync(ROOT_ENV_PATH, "utf8"));
  } catch {}
  const get = (...keys) => keys.map((k) => process.env[k] || file.get(k)).find(Boolean);
  return {
    token: get("BRANN_DISCORD_TOKEN", "DISCORD_BOT_TOKEN"),
    key: get("BRANN_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    model: get("BRANN_MODEL") || DEFAULT_MODEL,
  };
}

const nameOf = (m) => m.member?.nick ?? m.author.global_name ?? m.author.username;
const oneLine = (text, max = 160) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
  const limitAt = args.indexOf("--limit");
  const limit = Math.min(limitAt >= 0 ? Number(args[limitAt + 1]) : 100, 100);
  const all = args.includes("--all");
  if (!name) throw new Error("usage: replay.mjs <channel> [--limit 100] [--all]");
  const { token, key, model } = env();
  if (!token) throw new Error("set BRANN_DISCORD_TOKEN or DISCORD_BOT_TOKEN");
  if (!key) throw new Error("set BRANN_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY");

  const api = discord(token);
  const channel = await findChannel(api, name);
  if (!channel) throw new Error(`the bot sees no channel named ${name}`);
  const me = await api("GET", "/users/@me");
  const guild = await api("GET", `/guilds/${channel.guild_id}`);
  const messages = (await api("GET", `/channels/${channel.id}/messages?limit=${limit}`)).reverse();
  // Without the Message Content intent Discord sends every message with its text blanked.
  if (messages.length && messages.every((m) => !m.content && !m.mentions?.some((u) => u.id === me.id))) {
    throw new Error("every message came back empty: switch on the Message Content intent in the Discord developer portal");
  }

  const moderators = new Map();
  const moderator = async (user) => {
    if (!moderators.has(user.id)) {
      const member = await api("GET", `/guilds/${guild.id}/members/${user.id}`).catch(() => null);
      moderators.set(user.id, member !== null && isModerator(member, guild));
    }
    return moderators.get(user.id);
  };

  // The rules first, in order; then the model for every message they let through.
  const rows = [];
  const meta = (m) => ({
    authorId: m.author.id,
    bot: !!m.author.bot,
    at: Date.parse(m.timestamp),
    repliesTo: m.referenced_message?.author.id,
    mentions: (m.mentions ?? []).map((u) => u.id),
  });
  const plain = (m) => m.content.replace(new RegExp(`<@!?${me.id}>`, "g"), "").trim();
  const contextOf = (m) => ({ id: m.id, replyTo: m.message_reference?.message_id, bot: !!m.author.bot, name: nameOf(m), text: plain(m) });
  // A replied-to message older than the window comes embedded in its reply.
  const byId = new Map(messages.flatMap((m) => (m.referenced_message ? [[m.referenced_message.id, m.referenced_message]] : [])));
  const lookup = (id) => (byId.has(id) ? contextOf(byId.get(id)) : null);
  for (const [i, m] of messages.entries()) {
    const row = { m, text: plain(m) };
    row.context = contextFor(contextOf(m), messages.slice(0, i).reverse().map(contextOf), lookup);
    rows.push(row);
    if (m.author.bot) row.skip = "bot";
    else if (!SPOKEN_TYPES.includes(m.type)) row.skip = "not a chat message";
    else if (m.mentions?.some((u) => u.id === me.id)) row.mode = "conversation";
    else {
      const ref = m.referenced_message;
      const authorIsModerator = await moderator(m.author);
      const ok = worthAsking({
        authorIsBot: false,
        authorIsModerator,
        text: row.text,
        repliesToOtherPerson: !!ref && !ref.author.bot && ref.author.id !== m.author.id,
      });
      const recent = messages.slice(Math.max(0, i - 30), i).map(meta);
      if (ok && beingHelped({ authorId: m.author.id, at: Date.parse(m.timestamp), recent })) row.skip = "someone is helping this player";
      else if (ok) row.mode = "channel";
      else row.skip = authorIsModerator ? "moderator" : ref && !ref.author.bot ? "reply to another player" : "too short";
    }
  }

  const client = new Anthropic({ apiKey: key });
  const faq = loadFaq();
  const system = systemPrompt(faq);
  const asked = rows.filter((r) => r.mode);
  for (let i = 0; i < asked.length; i += CONCURRENCY) {
    await Promise.all(asked.slice(i, i + CONCURRENCY).map(async (row) => {
      try {
        row.result = await ask(client, {
          model, faq, system, mode: row.mode, context: row.context, turns: [{ bot: false, name: nameOf(row.m), text: row.text }],
        });
      } catch (error) {
        row.skip = `model error: ${error.message}`;
      }
    }));
  }

  // The per-player cooldown, as the bot would apply it in time order.
  const last = new Map();
  for (const row of rows.filter((r) => r.result?.answer)) {
    const at = Date.parse(row.m.timestamp);
    if (row.mode === "channel" && at - (last.get(row.m.author.id) ?? -Infinity) < COOLDOWN) {
      row.skip = "answered this player under a minute ago";
      continue;
    }
    last.set(row.m.author.id, at);
    row.answered = true;
  }

  const answered = rows.filter((r) => r.answered);
  console.log(`#${channel.name}: ${rows.length} messages, ${asked.length} sent to ${model}, ${answered.length} answered\n`);
  for (const row of rows) {
    const when = row.m.timestamp.slice(0, 16).replace("T", " ");
    if (row.answered) {
      console.log(`ANSWER  ${when} ${nameOf(row.m)}: ${oneLine(row.text)}`);
      console.log(`        entry: ${row.result.entry || "(none)"}`);
      console.log(`        ${row.result.reply.split("\n").join("\n        ")}\n`);
    } else if (all) {
      const why = row.skip ?? "silent: the FAQ does not cover it";
      console.log(`-       ${when} ${nameOf(row.m)}: ${oneLine(row.text, 100)}  [${why}]`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
