#!/usr/bin/env node
// Brann Bronzebeard, the Spoken Discord server's bot, always connected (apps/brann/README.md).
//
// - Support: reads every channel he can see, and answers a question the FAQ (docs/support/FAQ.md)
//   covers in a thread under it, in the asker's language. In that thread, and in DMs, he keeps
//   talking with the asker.
// - Issues: files each #bugs-forever-era post and each message a moderator marks with 🐛 as a
//   GitHub issue the moment it appears (issues.mjs).
//
// Environment (deploy/web/ecosystem.config.js passes these from shared/app.env):
//   BRANN_DISCORD_TOKEN       the bot's token. Required.
//   BRANN_ANTHROPIC_API_KEY   unset: no support answers
//   BRANN_GITHUB_TOKEN        issues: write on the repository. Unset: no issue filing
//   BRANN_GITHUB_REPOSITORY   default rusty-key/spoken-wow
//   BRANN_MODEL               default claude-sonnet-5-5
//   BRANN_SUPPORT             on (default), dry (log the answers, post nothing) or off
//   BRANN_DAILY_CALLS         model calls a UTC day before he stops answering, default 1000
//   BRANN_TEST_CHANNEL        a channel where he treats moderators as players and logs every
//                             decision, skips included, so his answering can be tried there

import Anthropic from "@anthropic-ai/sdk";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  MessageType,
  Partials,
  PermissionFlagsBits,
} from "discord.js";

import { discord, isNamed } from "../../../scripts/lib/language-post.mjs";
import { BUG, github } from "../../../scripts/lib/forum-issues.mjs";
import {
  DM_BUTTON,
  HELPED,
  NOT_HELPED,
  answerComponents,
  askerOf,
  ratedComponents,
} from "./feedback.mjs";
import { issueFiler } from "./issues.mjs";
import {
  COOLDOWN,
  DEFAULT_MODEL,
  HISTORY,
  ask,
  badSecrets,
  contextFor,
  dailyBudget,
  decide,
  faqEntries,
  loadFaq,
  perPlayer,
  threadName,
  withoutMention,
} from "./support.mjs";

const env = process.env;
const token = env.BRANN_DISCORD_TOKEN;
if (!token) {
  console.error("brann: BRANN_DISCORD_TOKEN is not set");
  process.exit(1);
}
const broken = badSecrets(env, ["BRANN_DISCORD_TOKEN", "BRANN_ANTHROPIC_API_KEY", "BRANN_GITHUB_TOKEN"]);
for (const name of broken) {
  console.error(`brann: ${name} is not a whole key: it holds a space or a character like "…". Copy it again.`);
}
if (broken.includes("BRANN_DISCORD_TOKEN")) process.exit(1);
const usable = (name) => !!env[name] && !broken.includes(name);
const TEST_CHANNEL = env.BRANN_TEST_CHANNEL;
const MODE = env.BRANN_SUPPORT ?? "on";
const MODEL = env.BRANN_MODEL || DEFAULT_MODEL;
const REPO = env.BRANN_GITHUB_REPOSITORY || "rusty-key/spoken-wow";

const faq = loadFaq();
const anthropic = usable("BRANN_ANTHROPIC_API_KEY") ? new Anthropic({ apiKey: env.BRANN_ANTHROPIC_API_KEY }) : null;
const supportOn = MODE !== "off" && anthropic !== null;
const spend = dailyBudget(Number(env.BRANN_DAILY_CALLS) || 1000);
const playerAllowed = perPlayer(20, 60 * 60 * 1000);
// Players a channel answer is being worked out for: their next messages count as answered, so a
// burst of them is one model call.
const asking = new Set();
// When he last answered each player in a channel. Only the last minute matters, so older entries
// are dropped as new ones come in.
const lastAnswered = new Map();
function answered(playerId, at) {
  for (const [id, when] of lastAnswered) if (at - when > COOLDOWN) lastAnswered.delete(id);
  lastAnswered.set(playerId, at);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Privileged: switched on for the bot in the Discord developer portal.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  // DM channels and reactions on messages from before the bot started arrive uncached.
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const filer = usable("BRANN_GITHUB_TOKEN")
  ? issueFiler({ api: discord(token), gh: github(env.BRANN_GITHUB_TOKEN, REPO) })
  : null;

const isModerator = (member) =>
  !!member && (member.guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageMessages));

const plain = (message) => withoutMention(message.content, client.user.id);
const nameOf = (message) => message.member?.displayName ?? message.author.globalName ?? message.author.username;

/** A message as a turn of a conversation: Brann's own, or a player's with their name. */
const turnOf = (message) => ({
  bot: message.author.id === client.user.id,
  name: nameOf(message),
  text: message.author.id === client.user.id ? message.content : plain(message),
});

/** A message as context for a channel question: also what it replies to, and whether any bot said it. */
const contextOf = (message) => ({
  ...turnOf(message),
  id: message.id,
  replyTo: message.reference?.messageId,
  bot: message.author.bot,
});

const where = (channel) => (channel.isDMBased() ? "DM" : `#${channel.name}`);

/** Whether a channel, or the channel a thread is in, is the test channel. */
const isTest = (channel) => !!TEST_CHANNEL && [channel, channel.parent].some((c) => c?.name && isNamed(c, TEST_CHANNEL));

async function answer(mode, turns, channel, playerId, context = []) {
  if (!playerAllowed(playerId, Date.now())) {
    console.warn(`brann: player ${playerId} reached 20 answers this hour`);
    return null;
  }
  if (!spend()) {
    console.warn("brann: daily model call limit reached; not answering until 00:00 UTC");
    return null;
  }
  const { entry, reply } = await ask(anthropic, { model: MODEL, faq, mode, turns, context });
  if (!reply) return null;
  console.log(`brann: ${where(channel)} ${mode} -> ${entry || "(no entry)"}`);
  if (MODE === "dry") {
    console.log(`brann: [dry] ${reply.replace(/\n/g, " ⏎ ")}`);
    return null;
  }
  return reply;
}

/**
 * A conversation: a DM, or the asker in his own thread, where `starter` and `history` (newest
 * first) are already fetched.
 */
async function converse(message, { starter = null, history } = {}) {
  const channel = message.channel;
  await channel.sendTyping().catch(() => {});
  const recent = history ?? await channel.messages.fetch({ limit: HISTORY });
  const turns = [...(starter ? [starter] : []), ...[...recent.values()].reverse().filter((m) => !m.system)].map(turnOf);
  const reply = await answer("conversation", turns, channel, message.author.id);
  if (!reply) return;
  // In a thread the asker can rate each answer; a DM is between the two of them, and the
  // weekly sweep cannot read it.
  await channel.send({ content: reply, allowedMentions: { parse: [] }, components: channel.isDMBased() ? [] : answerComponents() });
}

/** A message in a public channel: answered in a thread under it, or in place in a thread already. */
async function triage(message, mode, context, note) {
  const reply = await answer(mode, [turnOf(message)], message.channel, message.author.id, context);
  if (!reply) {
    note("no answer: the FAQ does not cover it (or a limit above was reached)");
    return;
  }
  answered(message.author.id, Date.now());
  const content = `<@${message.author.id}> ${reply}`;
  const components = answerComponents();
  const thread = message.channel.isThread()
    ? null
    : await message.startThread({ name: threadName(plain(message)), autoArchiveDuration: 1440 }).catch(() => null);
  if (thread) await thread.send({ content, components, allowedMentions: { users: [message.author.id] } });
  else await message.reply({ content, components, allowedMentions: { users: [message.author.id], repliedUser: false } });
}

/**
 * The thread and its history when a message is the asker talking to him in one of his threads
 * with no moderator in it, else null.
 */
async function hisConversation(message) {
  const thread = message.channel;
  if (!thread.isThread() || thread.ownerId !== client.user.id) return null;
  const [starter, history] = await Promise.all([
    thread.fetchStarterMessage().catch(() => null),
    thread.messages.fetch({ limit: HISTORY }),
  ]);
  if (!starter || starter.author.id !== message.author.id) return null;
  // A moderator who joined has taken over; Brann steps back. Fetched history carries no member,
  // so each other person in it is looked up (once; discord.js keeps them).
  const others = new Set(history.filter((m) => !m.author.bot && m.author.id !== message.author.id).map((m) => m.author.id));
  const members = await Promise.all([...others].map((id) => message.guild.members.fetch(id).catch(() => null)));
  if (members.some(isModerator)) return null;
  return { starter, history };
}

/** The channel's last 30 messages before `message`, and the chain it replies to past them. */
async function surroundings(message, ref) {
  const before = [...(await message.channel.messages.fetch({ limit: 30, before: message.id })).values()];
  const chain = new Map(ref ? [[ref.id, ref]] : []);
  for (let id = ref?.reference?.messageId; id && chain.size < 5 && !before.some((m) => m.id === id); ) {
    const m = await message.channel.messages.fetch(id).catch(() => null);
    if (!m) break;
    chain.set(m.id, m);
    id = m.reference?.messageId;
  }
  return { before, chain };
}

client.on(Events.MessageCreate, async (message) => {
  if (!supportOn || message.author.bot || message.system) return;
  if (![MessageType.Default, MessageType.Reply].includes(message.type)) return;
  try {
    if (message.channel.isDMBased()) {
      await converse(message);
      return;
    }
    if (message.channel.type === ChannelType.GuildAnnouncement) return;
    const conversation = await hisConversation(message);
    if (conversation) {
      await converse(message, conversation);
      return;
    }
    // In the test channel a moderator is a player, and each decision is logged.
    const testing = isTest(message.channel);
    const note = (what) => {
      if (testing) console.log(`brann: ${where(message.channel)} ${message.author.username}: ${what}`);
    };
    const facts = {
      mentioned: message.mentions.users.has(client.user.id),
      isModerator: !testing && isModerator(message.member),
      text: plain(message),
      authorId: message.author.id,
      at: message.createdTimestamp,
      answeredAt: asking.has(message.author.id) ? message.createdTimestamp : lastAnswered.get(message.author.id),
    };
    // The free rules first: a message they skip costs no fetch.
    const first = decide(facts);
    if (first.skip) {
      note(`skip: ${first.skip}`);
      return;
    }
    if (!facts.mentioned) asking.add(message.author.id);
    try {
      await consider(message, facts, note);
    } finally {
      asking.delete(message.author.id);
    }
  } catch (error) {
    console.error(`brann: ${where(message.channel)} message ${message.id}: ${error.message}`);
  }
});

/** The rules that need a fetch, then the answer: a channel message the free rules let through. */
async function consider(message, facts, note) {
  const ref = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  const { before, chain } = await surroundings(message, ref);
  const verdict = decide({
    ...facts,
    repliesToOtherPerson: !!ref && !ref.author.bot && ref.author.id !== message.author.id,
    recent: before.map((m) => ({
      authorId: m.author.id,
      bot: m.author.bot,
      at: m.createdTimestamp,
      repliesTo: m.mentions.repliedUser?.id,
      mentions: [...m.mentions.users.keys()],
    })),
  });
  if (verdict.skip) {
    note(`skip: ${verdict.skip}`);
    return;
  }
  note(`asking the model (${verdict.mode})`);
  const lookup = (id) => (chain.has(id) ? contextOf(chain.get(id)) : null);
  await triage(message, verdict.mode, contextFor(contextOf(message), before.map(contextOf), lookup), note);
}

/** The channel a button was pressed in. An old thread is no longer in discord.js's cache after a restart. */
const channelOf = async (interaction) =>
  interaction.channel ?? await client.channels.fetch(interaction.channelId).catch(() => null);

// 👍 or 👎 from the asker: the buttons become the verdict, which the weekly FAQ sweep reads.
async function rate(interaction, helped) {
  const thread = await channelOf(interaction);
  const starter = thread?.isThread() && thread.ownerId === client.user.id
    ? await thread.fetchStarterMessage().catch(() => null)
    : null;
  const asker = askerOf(interaction.message.content, starter?.author.id);
  if (interaction.user.id !== asker) {
    await interaction.reply({ content: "Only the person who asked can rate this answer.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update({ components: ratedComponents(helped) });
  console.log(`brann: answer ${interaction.message.id} ${helped ? "helped" : "did not help"}`);
  if (!helped) {
    await interaction.followUp({
      content: "Thanks for telling me. Ask again here in your own words, or ask a moderator, and I'll learn from it.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

// "Continue in DMs": the question and his answer go to the player's DMs, where the talk goes on.
async function moveToDm(interaction) {
  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  try {
    const answerText = interaction.message.content.replace(/^<@!?\d+>\s*/, "");
    const thread = await channelOf(interaction);
    const starter = thread?.isThread() ? await thread.fetchStarterMessage().catch(() => null) : null;
    const question = starter?.author.id === interaction.user.id ? plain(starter) : null;
    const quoted = question ? `${question.split("\n").map((l) => `> ${l}`).join("\n")}\n\n` : "";
    await interaction.user.send({ content: `${quoted}${answerText}`.slice(0, 2000), allowedMentions: { parse: [] } });
    await ephemeral("Sent you a DM. Let's carry on there!");
  } catch {
    await ephemeral("I couldn't DM you. Your DMs from server members may be off. We can carry on here.").catch(() => {});
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  try {
    if (interaction.customId === DM_BUTTON) await moveToDm(interaction);
    else if (interaction.customId === HELPED) await rate(interaction, true);
    else if (interaction.customId === NOT_HELPED) await rate(interaction, false);
  } catch (error) {
    console.error(`brann: button ${interaction.customId}: ${error.message}`);
  }
});

client.on(Events.ThreadCreate, (thread, newlyCreated) => filer?.onThreadCreate(thread, newlyCreated));

// Only a moderator's 🐛 files a message; asking the gateway's member cache first spares the filer
// its Discord and GitHub lookups for everyone else's.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (!filer || reaction.emoji.name !== BUG) return;
  const member = await reaction.message.guild?.members.fetch(user.id).catch(() => null);
  if (isModerator(member)) filer.onReactionAdd(reaction.message.channelId, reaction.message.id);
});

client.once(Events.ClientReady, (ready) => {
  console.log(`brann: logged in as ${ready.user.tag}`);
  console.log(`brann: support ${supportOn ? `${MODE}, ${MODEL}, ${faqEntries(faq).length} FAQ entries` : "off"}`);
  if (TEST_CHANNEL) console.log(`brann: test channel #${TEST_CHANNEL}: moderators count as players, every decision is logged`);
  console.log(`brann: issue filing ${filer ? `on, ${REPO}` : "off (BRANN_GITHUB_TOKEN is not set)"}`);
  filer?.start();
});

// pm2 stops the process with SIGINT on a reload.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    client.destroy().finally(() => process.exit(0));
  });
}

await client.login(token);
