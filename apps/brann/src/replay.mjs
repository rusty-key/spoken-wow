#!/usr/bin/env node
// Replays a channel's recent messages through Brann's support rules (decide in support.mjs, the
// same function the bot asks) and model call, and prints which he would answer and what he would
// say. Posts nothing, files nothing (README.md).
//
//   node apps/brann/src/replay.mjs <channel> [--limit 100] [--all]
//
// Reads BRANN_DISCORD_TOKEN or DISCORD_BOT_TOKEN, and BRANN_ANTHROPIC_API_KEY or
// ANTHROPIC_API_KEY, from the environment or the repo-root .env.

import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { loadEnv } from "../../../pipelines/lib/env.mjs";
import { moderatorLookup, nameOf as authorName } from "../../../scripts/lib/forum-issues.mjs";
import { discord, findChannel } from "../../../scripts/lib/language-post.mjs";
import { DEFAULT_MODEL, ask, contextFor, decide, loadFaq, oneLine, withoutMention } from "./support.mjs";

// Default and Reply: what the bot looks at. Joins, pins and the like are not questions.
const SPOKEN_TYPES = [0, 19];
const CONCURRENCY = 5;

const nameOf = (m) => m.member?.nick ?? authorName(m.author);

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
  const limitAt = args.indexOf("--limit");
  const limit = Math.min(limitAt >= 0 ? Number(args[limitAt + 1]) : 100, 100);
  const all = args.includes("--all");
  if (!name) throw new Error("usage: replay.mjs <channel> [--limit 100] [--all]");
  await loadEnv();
  const token = process.env.BRANN_DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const key = process.env.BRANN_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const model = process.env.BRANN_MODEL || DEFAULT_MODEL;
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
  const moderator = moderatorLookup(api, guild);

  const plain = (m) => withoutMention(m.content, me.id);
  const contextOf = (m) => ({ id: m.id, replyTo: m.message_reference?.message_id, bot: !!m.author.bot, name: nameOf(m), text: plain(m) });
  const meta = (m) => ({
    authorId: m.author.id,
    bot: !!m.author.bot,
    at: Date.parse(m.timestamp),
    repliesTo: m.referenced_message?.author.id,
    mentions: (m.mentions ?? []).map((u) => u.id),
  });
  // A replied-to message older than the window comes embedded in its reply.
  const embedded = new Map(messages.flatMap((m) => (m.referenced_message ? [[m.referenced_message.id, m.referenced_message]] : [])));
  const lookup = (id) => (embedded.has(id) ? contextOf(embedded.get(id)) : null);

  // The rules, as the bot asks them; the cooldown waits until the answers are known, below.
  const rows = [];
  for (const [i, m] of messages.entries()) {
    const row = { m, text: plain(m) };
    rows.push(row);
    if (m.author.bot) row.skip = "bot";
    else if (!SPOKEN_TYPES.includes(m.type)) row.skip = "not a chat message";
    else {
      const ref = m.referenced_message;
      row.facts = {
        mentioned: !!m.mentions?.some((u) => u.id === me.id),
        isModerator: await moderator(m.author.id),
        text: row.text,
        authorId: m.author.id,
        at: Date.parse(m.timestamp),
        repliesToOtherPerson: !!ref && !ref.author.bot && ref.author.id !== m.author.id,
        recent: messages.slice(Math.max(0, i - 30), i).map(meta),
      };
      const verdict = decide(row.facts);
      if (verdict.skip) row.skip = verdict.skip;
      else row.mode = verdict.mode;
      row.context = contextFor(contextOf(m), messages.slice(0, i).reverse().map(contextOf), lookup);
    }
  }

  const client = new Anthropic({ apiKey: key });
  const faq = loadFaq();
  const asked = rows.filter((r) => r.mode);
  for (let i = 0; i < asked.length; i += CONCURRENCY) {
    await Promise.all(asked.slice(i, i + CONCURRENCY).map(async (row) => {
      try {
        row.result = await ask(client, {
          model, faq, mode: row.mode, context: row.context, turns: [{ bot: false, name: nameOf(row.m), text: row.text }],
        });
      } catch (error) {
        row.skip = `model error: ${error.message}`;
      }
    }));
  }

  // The cooldown, in time order: each player's last answer is known once the earlier ones are.
  const last = new Map();
  for (const row of rows.filter((r) => r.result?.reply)) {
    const verdict = decide({ ...row.facts, answeredAt: last.get(row.m.author.id) });
    if (verdict.skip) {
      row.skip = verdict.skip;
      continue;
    }
    last.set(row.m.author.id, row.facts.at);
    row.answered = true;
  }

  const answered = rows.filter((r) => r.answered);
  console.log(`#${channel.name}: ${rows.length} messages, ${asked.length} sent to ${model}, ${answered.length} answered\n`);
  for (const row of rows) {
    const when = row.m.timestamp.slice(0, 16).replace("T", " ");
    if (row.answered) {
      console.log(`ANSWER  ${when} ${nameOf(row.m)}: ${oneLine(row.text, 160)}`);
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
