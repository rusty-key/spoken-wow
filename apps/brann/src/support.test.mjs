import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_REPLY,
  beingHelped,
  contextFor,
  dailyBudget,
  faqEntries,
  messagesFor,
  parseAnswer,
  systemPrompt,
  decide,
  perPlayer,
  oneLine,
  threadName,
  withoutMention,
} from "./support.mjs";

const FAQ = "# Spoken FAQ\n\nIntro.\n\n## How do I install Spoken?\n\nUse the Manager.\n\n## Why is nothing playing?\n\nCheck the packs.\n";

const reply = (body, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text: JSON.stringify(body) }] });

test("faqEntries lists the level-two headings", () => {
  assert.deepEqual(faqEntries(FAQ), ["How do I install Spoken?", "Why is nothing playing?"]);
});

test("the system prompt holds the FAQ and nothing that changes per call", () => {
  assert.equal(systemPrompt(FAQ), systemPrompt(FAQ));
  assert.match(systemPrompt(FAQ), /## Why is nothing playing\?/);
});

test("an answer is read when it is finished and well formed", () => {
  const got = parseAnswer(reply({ answer: true, entry: "Why is nothing playing?", reply: " Check the packs. " }), FAQ);
  assert.deepEqual(got, { entry: "Why is nothing playing?", reply: "Check the packs." });
});

test("anything but a finished, well-formed answer is silence", () => {
  const silent = { entry: "", reply: "" };
  assert.deepEqual(parseAnswer(reply({ answer: true, entry: "", reply: "x" }, "refusal"), FAQ), silent);
  assert.deepEqual(parseAnswer(reply({ answer: true, entry: "", reply: "x" }, "max_tokens"), FAQ), silent);
  assert.deepEqual(parseAnswer({ stop_reason: "end_turn", content: [{ type: "text", text: "{oops" }] }, FAQ), silent);
  assert.deepEqual(parseAnswer(reply({ answer: false, entry: "", reply: "Hi" }), FAQ), silent);
  assert.deepEqual(parseAnswer(reply({ answer: true, entry: "", reply: "   " }), FAQ), silent);
  assert.deepEqual(parseAnswer(reply({ answer: "yes", entry: "", reply: "Hi" }), FAQ), silent);
});

test("an entry not in the FAQ is dropped, and a long reply is cut to fit Discord", () => {
  const got = parseAnswer(reply({ answer: true, entry: "Made up", reply: "a".repeat(5000) }), FAQ);
  assert.equal(got.entry, "");
  assert.equal(got.reply.length, MAX_REPLY);
});

test("messagesFor names the speakers, merges runs of one role and starts with the player", () => {
  const messages = messagesFor("conversation", [
    { bot: true, name: "Brann", text: "Stray bot line" },
    { bot: false, name: "Ana", text: "No sound" },
    { bot: false, name: "Ana", text: "at all" },
    { bot: true, name: "Brann", text: "Check the packs." },
    { bot: false, name: "Ana", text: "Which ones?" },
    { bot: true, name: "Brann", text: "Trailing bot line" },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "mode: conversation\n\nEarlier, you said:\nStray bot line\n\nAna: No sound\n\nAna: at all" },
    { role: "assistant", content: "Check the packs." },
    { role: "user", content: "Ana: Which ones?" },
  ]);
});

test("messagesFor with nothing a player said is empty", () => {
  assert.deepEqual(messagesFor("channel", [{ bot: true, name: "Brann", text: "hi" }]), []);
});

test("decide: a mention is a conversation; moderators, chatter and a player just answered are skipped", () => {
  const at = Date.parse("2026-11-17T00:40:00Z");
  const base = { mentioned: false, isModerator: false, text: "Why don't my NPCs talk?", authorId: "ana", at };
  assert.deepEqual(decide(base), { mode: "channel" });
  assert.deepEqual(decide({ ...base, mentioned: true, isModerator: true, text: "hi" }), { mode: "conversation" });
  assert.deepEqual(decide({ ...base, isModerator: true }), { skip: "moderator" });
  assert.deepEqual(decide({ ...base, text: "thx!" }), { skip: "too short" });
  assert.deepEqual(decide({ ...base, answeredAt: at - 30_000 }), { skip: "answered this player under a minute ago" });
  assert.deepEqual(decide({ ...base, answeredAt: at - 90_000 }), { mode: "channel" });
  assert.deepEqual(decide({ ...base, repliesToOtherPerson: true }), { skip: "reply to another player" });
  const helper = { authorId: "nucabe", bot: false, at: at - 60_000, repliesTo: "ana", mentions: [] };
  assert.deepEqual(decide({ ...base, recent: [helper] }), { skip: "someone is helping this player" });
});

test("oneLine and withoutMention", () => {
  assert.equal(oneLine("a  b\nc", 10), "a b c");
  assert.equal(oneLine("abcdefghij", 5), "abcd…");
  assert.equal(withoutMention("<@9> <@!9>how do I <@1>", "9"), "how do I <@1>");
});

test("threadName takes the first line, without mentions, within Discord's limit", () => {
  assert.equal(threadName("<@123> No sound\nsecond line"), "No sound");
  assert.equal(threadName("x".repeat(200)).length, 90);
  assert.equal(threadName("<@123>"), "Question");
});

test("dailyBudget allows the limit each UTC day", () => {
  let now = new Date("2026-11-16T10:00:00Z");
  const spend = dailyBudget(2, () => now);
  assert.equal(spend(), true);
  assert.equal(spend(), true);
  assert.equal(spend(), false);
  now = new Date("2026-11-17T00:00:01Z");
  assert.equal(spend(), true);
});

test("beingHelped: someone else replied to or mentioned the player in the last ten minutes", () => {
  const at = Date.parse("2026-11-17T00:40:00Z");
  const said = (min, extra) => ({ authorId: "nucabe", bot: false, at: at - min * 60_000, repliesTo: undefined, mentions: [], ...extra });
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(5, { repliesTo: "flab" })] }), true);
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(5, { mentions: ["flab"] })] }), true);
  // Helping someone else, too long ago, a bot, or the player themself: Brann may answer.
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(5, { repliesTo: "jakill" })] }), false);
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(11, { repliesTo: "flab" })] }), false);
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(5, { repliesTo: "flab", bot: true })] }), false);
  assert.equal(beingHelped({ authorId: "flab", at, recent: [said(5, { authorId: "flab", mentions: ["flab"] })] }), false);
});

test("contextFor puts the reply chain first, fills with the messages just before, oldest first", () => {
  const m = (id, replyTo) => ({ id: String(id), replyTo: replyTo && String(replyTo) });
  // 10 replies to 3, which replies to 1; 9..4 came just before 10, newest first.
  const before = [m(9), m(8), m(7), m(6), m(5), m(4), m(3, 1), m(2), m(1)];
  const ids = (list) => list.map((x) => x.id);
  assert.deepEqual(ids(contextFor(m(10, 3), before)), ["1", "3", "7", "8", "9"]);
  // No reply: the five just before.
  assert.deepEqual(ids(contextFor(m(10), before)), ["5", "6", "7", "8", "9"]);
  // A replied-to message older than what was fetched is looked up.
  const old = m(0);
  assert.deepEqual(ids(contextFor({ id: "10", replyTo: "0" }, before.slice(0, 2), (id) => (id === "0" ? old : null))), ["0", "8", "9"]);
  // A loop in the chain ends.
  assert.deepEqual(ids(contextFor(m(10, 2), [m(2, 1), m(1, 2)])), ["1", "2"]);
});

test("a channel message goes to the model with its context marked apart", () => {
  const [message] = messagesFor("channel", [{ bot: false, name: "Mirades", text: "german voices too?" }], [
    { id: "1", name: "Jakill", bot: false, text: "It's 75 dollars\nper language" },
    { id: "2", name: "Brann", bot: true, text: "Hello" },
  ]);
  assert.equal(message.role, "user");
  assert.equal(message.content,
    "mode: channel\n\n<context>\nJakill: It's 75 dollars per language\nBrann (bot): Hello\n</context>\n\n<message>\nMirades: german voices too?\n</message>");
  assert.deepEqual(messagesFor("channel", [{ bot: false, name: "A", text: "  " }]), []);
});

test("perPlayer allows each player the limit in the window, then frees it", () => {
  const allow = perPlayer(2, 1000);
  assert.equal(allow("ana", 0), true);
  assert.equal(allow("ana", 10), true);
  assert.equal(allow("ana", 20), false);
  assert.equal(allow("bo", 20), true);
  assert.equal(allow("ana", 1001), true);
});
