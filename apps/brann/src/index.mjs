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

import { discord } from "../../../scripts/lib/language-post.mjs";
import { github } from "../../../scripts/lib/forum-issues.mjs";
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
  beingHelped,
  contextFor,
  dailyBudget,
  faqEntries,
  loadFaq,
  systemPrompt,
  threadName,
  worthAsking,
} from "./support.mjs";

const env = process.env;
const token = env.BRANN_DISCORD_TOKEN;
if (!token) {
  console.error("brann: BRANN_DISCORD_TOKEN is not set");
  process.exit(1);
}
const MODE = env.BRANN_SUPPORT ?? "on";
const MODEL = env.BRANN_MODEL || DEFAULT_MODEL;
const REPO = env.BRANN_GITHUB_REPOSITORY || "rusty-key/spoken-wow";

const faq = loadFaq();
const system = systemPrompt(faq);
const anthropic = env.BRANN_ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.BRANN_ANTHROPIC_API_KEY }) : null;
const supportOn = MODE !== "off" && anthropic !== null;
const spend = dailyBudget(Number(env.BRANN_DAILY_CALLS) || 1000);
const lastAnswered = new Map();

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

const filer = env.BRANN_GITHUB_TOKEN
  ? issueFiler({ api: discord(token), gh: github(env.BRANN_GITHUB_TOKEN, REPO) })
  : null;

const isModerator = (member) =>
  !!member && (member.guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageMessages));

const plain = (message) => message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();

const turnOf = (message) => ({
  bot: message.author.id === client.user.id,
  name: message.member?.displayName ?? message.author.globalName ?? message.author.username,
  text: message.author.id === client.user.id ? message.content : plain(message),
});

/** A message as context for a channel question: who said what, and what it replies to. */
const contextOf = (message) => ({
  id: message.id,
  replyTo: message.reference?.messageId,
  bot: message.author.bot,
  name: message.member?.displayName ?? message.author.globalName ?? message.author.username,
  text: message.author.id === client.user.id ? message.content : plain(message),
});


const where = (channel) => (channel.isDMBased() ? "DM" : `#${channel.name}`);

async function answer(mode, turns, channel, context = []) {
  if (!spend()) {
    console.warn("brann: daily model call limit reached; not answering until 00:00 UTC");
    return null;
  }
  const result = await ask(anthropic, { model: MODEL, faq, system, mode, turns, context });
  if (!result.answer) return null;
  console.log(`brann: ${where(channel)} ${mode} -> ${result.entry || "(no entry)"}`);
  if (MODE === "dry") {
    console.log(`brann: [dry] ${result.reply.replace(/\n/g, " ⏎ ")}`);
    return null;
  }
  return result.reply;
}

/** A message in his own thread from the person it was opened for, or a DM: a conversation. */
async function converse(message) {
  const channel = message.channel;
  const history = [...(await channel.messages.fetch({ limit: HISTORY })).values()].reverse();
  const turns = [];
  if (channel.isThread()) {
    const starter = await channel.fetchStarterMessage().catch(() => null);
    if (starter) turns.push(turnOf(starter));
  }
  turns.push(...history.filter((m) => !m.system).map(turnOf));
  await channel.sendTyping().catch(() => {});
  const reply = await answer("conversation", turns, channel);
  if (!reply) return;
  // In a thread the asker can rate each answer; a DM is between the two of them, and the
  // weekly sweep cannot read it.
  const components = channel.isDMBased() ? [] : answerComponents({ dm: true });
  await channel.send({ content: reply, allowedMentions: { parse: [] }, components });
}

/** A message in a public channel: answered in a thread under it if the FAQ covers it. */
async function triage(message, mentioned, context) {
  if (!mentioned) {
    const last = lastAnswered.get(message.author.id) ?? 0;
    if (Date.now() - last < COOLDOWN) return;
  }
  const reply = await answer(mentioned ? "conversation" : "channel", [turnOf(message)], message.channel, context);
  if (!reply) return;
  lastAnswered.set(message.author.id, Date.now());
  const payload = {
    content: `<@${message.author.id}> ${reply}`,
    allowedMentions: { users: [message.author.id] },
    components: answerComponents({ dm: true }),
  };
  // Already in a thread (a forum post, someone's thread): answer in place.
  if (message.channel.isThread()) {
    await message.reply({ ...payload, allowedMentions: { users: [message.author.id], repliedUser: false } });
    return;
  }
  const thread = await message
    .startThread({ name: threadName(plain(message)), autoArchiveDuration: 1440 })
    .catch(() => null);
  if (thread) await thread.send(payload);
  else await message.reply({ ...payload, allowedMentions: { users: [message.author.id], repliedUser: false } });
}

/** Whether a message in one of his threads is the asker talking to him, with no moderator in it. */
async function isHisConversation(message) {
  const thread = message.channel;
  if (!thread.isThread() || thread.ownerId !== client.user.id) return false;
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter || starter.author.id !== message.author.id) return false;
  // A moderator who joined has taken over; Brann steps back.
  const recent = await thread.messages.fetch({ limit: HISTORY });
  return !recent.some((m) => !m.author.bot && m.author.id !== message.author.id && isModerator(m.member));
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
    if (await isHisConversation(message)) {
      await converse(message);
      return;
    }
    const mentioned = message.mentions.users.has(client.user.id);
    const ref = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
    const repliesToOtherPerson = !!ref && !ref.author.bot && ref.author.id !== message.author.id;
    const ok = mentioned
      || worthAsking({
        authorIsBot: message.author.bot,
        authorIsModerator: isModerator(message.member),
        text: plain(message),
        repliesToOtherPerson,
      });
    if (!ok) return;
    const before = [...(await message.channel.messages.fetch({ limit: 30, before: message.id })).values()];
    if (!mentioned) {
      const recent = before.map((m) => ({
        authorId: m.author.id,
        bot: m.author.bot,
        at: m.createdTimestamp,
        repliesTo: m.mentions.repliedUser?.id,
        mentions: [...m.mentions.users.keys()],
      }));
      if (beingHelped({ authorId: message.author.id, at: message.createdTimestamp, recent })) return;
    }
    const fetched = new Map(ref ? [[ref.id, ref]] : []);
    const lookup = (id) => {
      const m = fetched.get(id);
      return m ? contextOf(m) : null;
    };
    // A chain reaching past the last 30 messages: fetch what it needs, before reading it.
    for (let id = ref?.reference?.messageId; id && fetched.size < 5 && !before.some((m) => m.id === id); ) {
      const m = await message.channel.messages.fetch(id).catch(() => null);
      if (!m) break;
      fetched.set(m.id, m);
      id = m.reference?.messageId;
    }
    const context = contextFor(contextOf(message), before.map(contextOf), lookup);
    await triage(message, mentioned, context);
  } catch (error) {
    console.error(`brann: ${where(message.channel)} message ${message.id}: ${error.message}`);
  }
});

// 👍 or 👎 from the asker: the buttons become the verdict, which the weekly FAQ sweep reads.
async function rate(interaction, helped) {
  const thread = interaction.channel;
  const starter = thread?.isThread() && thread.ownerId === client.user.id
    ? await thread.fetchStarterMessage().catch(() => null)
    : null;
  const asker = askerOf(interaction.message.content, starter?.author.id);
  if (interaction.user.id !== asker) {
    await interaction.reply({ content: "Only the person who asked can rate this answer.", flags: MessageFlags.Ephemeral });
    return;
  }
  const components = ratedComponents(interaction.message.components.map((row) => row.toJSON()), helped);
  await interaction.update({ components });
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
    const thread = interaction.channel;
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

client.on(Events.MessageReactionAdd, (reaction) =>
  filer?.onReactionAdd(reaction.message.channelId, reaction.message.id, reaction.emoji.name),
);

client.once(Events.ClientReady, (ready) => {
  console.log(`brann: logged in as ${ready.user.tag}`);
  console.log(`brann: support ${supportOn ? `${MODE}, ${MODEL}, ${faqEntries(faq).length} FAQ entries` : "off"}`);
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
