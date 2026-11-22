import { test } from "node:test";
import assert from "node:assert/strict";

import {
  closedReply, isForum, isModerator, issueFor, labelsFor, messageIssueFor, messageOf, reaction, threadOf,
} from "./forum-issues.mjs";

const thread = { id: "222", name: "Quest text cut off", thread_metadata: { create_timestamp: "2026-10-20T12:00:00.000Z" } };
const starter = (content, extra = {}) => ({ content, author: { username: "pud2000", global_name: "Pud" }, attachments: [], ...extra });

test("only the footer's link stands for the post, not a link the post itself quotes", () => {
  assert.deepEqual(threadOf("Posted by **Pud** in [#bugs](https://discord.com/channels/111/222) on Discord"),
    { guild: "111", thread: "222" });
  assert.deepEqual(threadOf("Posted by **Pud** in [#bugs-forever-era](https://discord.com/channels/111/222) on Discord"),
    { guild: "111", thread: "222" });
  assert.deepEqual(threadOf("Posted by **Pud** in [#bugs-and-ideas](https://discord.com/channels/111/222) on Discord"),
    { guild: "111", thread: "222" });
  assert.equal(threadOf("Posted by **Pud** in [#bugs-1-12](https://discord.com/channels/111/222) on Discord"), null);
  assert.equal(threadOf("See https://discord.com/channels/111/222/333 for the message"), null);
  assert.equal(threadOf(null), null);
  const issue = issueFor({ guild: "111", thread, starter: starter("Same as https://discord.com/channels/111/999"), tagNames: [] });
  assert.deepEqual(threadOf(issue.body), { guild: "111", thread: "222" });
});

test("the forum is found under its name and its earlier ones, but not another client's forum", () => {
  for (const name of ["bugs", "🐞｜bugs", "bugs-forever-era", "bugs-and-ideas"]) assert.ok(isForum({ name }), name);
  for (const name of ["bugs-1-12", "bugs-3-3-5a", "old-bugs"]) assert.ok(!isForum({ name }), name);
});

test("a post's @names and #numbers neither ping nor link on GitHub", () => {
  const issue = issueFor({ guild: "111", thread: { ...thread, name: "Broken since #12" }, starter: starter("ask @octocat"), tagNames: [] });
  assert.equal(issue.title, "Broken since #​12");
  assert.match(issue.body, /> ask @​octocat/);
});

test("tags become the repository's labels, always with from-discord and never twice", () => {
  assert.deepEqual(labelsFor(["Bug", "Quests", "Gossip", "Forever"]), ["from-discord", "bug", "Addon / Spoken Quests"]);
  assert.deepEqual(labelsFor([]), ["from-discord"]);
});

test("the issue quotes the post line by line and links back to it", () => {
  const issue = issueFor({ guild: "111", thread, starter: starter("Mulgore quests are silent.\n\nOnly Contribute shows."), tagNames: ["Bug"] });
  assert.equal(issue.title, "Quest text cut off");
  assert.equal(issue.body, [
    "**Original report**",
    "> Mulgore quests are silent.",
    ">",
    "> Only Contribute shows.",
    "",
    "---",
    "Posted by **Pud** in [#bugs](https://discord.com/channels/111/222) on Discord · 2026-10-20T12:00:00.000Z",
  ].join("\n"));
  assert.deepEqual(threadOf(issue.body), { guild: "111", thread: "222" });
});

test("a post with only pictures, or whose first message is gone, still files", () => {
  const pictures = issueFor({ guild: "111", thread, starter: starter("", { attachments: [{}, {}] }), tagNames: [] });
  assert.match(pictures.body, /> \(no text\)\n\n2 attachments in the Discord post\./);
  assert.match(issueFor({ guild: "111", thread, starter: null, tagNames: [] }).body, /Posted by \*\*someone\*\*/);
});

test("a closed issue tells the post fixed, not planned, or a duplicate with no tag", () => {
  const url = "https://github.com/o/r/issues/5";
  assert.equal(closedReply({ state_reason: "completed", html_url: url }).tag, "Fixed");
  assert.equal(closedReply({ state_reason: "not_planned", html_url: url }).tag, "Not planned");
  assert.equal(closedReply({ state_reason: "duplicate", html_url: url }).tag, null);
  assert.match(closedReply({ state_reason: "completed", html_url: url }).content, /issues\/5/);
});

test("a 🐛 issue quotes the message after the ones before it, and its footer links the message", () => {
  const msg = (id, name, content, at) => ({ id, content, timestamp: at, author: { username: name }, attachments: [] });
  const issue = messageIssueFor({
    guild: "111",
    channel: { id: "333", name: "🍺｜general" },
    target: msg("3", "pud2000", "Mulgore quests are silent\nsince the update", "2026-10-21T10:02:00.000Z"),
    context: [msg("1", "rusty", "which pack?", "2026-10-21T10:00:00.000Z"), msg("2", "pud2000", "@rusty all of them #12", "2026-10-21T10:01:00.000Z")],
    reactor: { username: "nucabe" },
  });
  assert.equal(issue.title, "Mulgore quests are silent");
  assert.deepEqual(issue.labels, ["from-discord"]);
  assert.ok(issue.body.indexOf("which pack?") < issue.body.indexOf("Mulgore quests are silent"));
  assert.match(issue.body, /@​rusty all of them #​12/);
  assert.deepEqual(messageOf(issue.body), { guild: "111", channel: "333", message: "3" });
  assert.equal(threadOf(issue.body), null);
});

test("a forum post's footer is not read as a message, nor a message's as a post", () => {
  const post = issueFor({ guild: "111", thread, starter: starter("x"), tagNames: [] });
  assert.equal(messageOf(post.body), null);
});

test("moderators are the owner and members whose roles manage messages", () => {
  const guild = {
    id: "g",
    owner_id: "rusty",
    roles: [
      { id: "g", permissions: "1024" }, // @everyone: view channel only
      { id: "mod", permissions: String(1 << 13) },
      { id: "member", permissions: "0" },
    ],
  };
  assert.ok(isModerator({ user: { id: "rusty" }, roles: [] }, guild));
  assert.ok(isModerator({ user: { id: "nucabe" }, roles: ["mod", "member"] }, guild));
  assert.ok(!isModerator({ user: { id: "pud" }, roles: ["member"] }, guild));
});

// A server with the forum, one #general and a moderator, for `reaction`. Messages are by id.
function fakeServer(messages, { reactors = [{ id: "mod" }] } = {}) {
  const posted = [];
  const issues = [];
  const msg = (id) => messages.find((m) => m.id === id);
  const api = async (method, path, body) => {
    if (method === "POST") {
      posted.push({ path, body });
      return { id: "new" };
    }
    if (path === "/users/@me/guilds") return [{ id: "g" }];
    if (path === "/guilds/g/channels") return [{ id: "forum", guild_id: "g", name: "bugs", type: 15 }];
    if (path === "/guilds/g") return { id: "g", owner_id: "owner", roles: [{ id: "g", permissions: "0" }, { id: "modrole", permissions: String(1n << 13n) }] };
    if (path === "/guilds/g/members/mod") return { user: { id: "mod" }, roles: ["modrole"] };
    if (path.startsWith("/guilds/g/members/")) return { user: { id: "x" }, roles: [] };
    if (path === "/channels/general") return { id: "general", name: "general", type: 0, parent_id: null };
    if (path.includes("/reactions/")) return reactors;
    const one = path.match(/^\/channels\/general\/messages\/(\d+)$/);
    if (one) return msg(one[1]);
    const after = path.match(/after=(\d+)/);
    if (after) return messages.filter((m) => BigInt(m.id) > BigInt(after[1]));
    const before = path.match(/before=(\d+)&limit=(\d+)/);
    if (before) return messages.filter((m) => BigInt(m.id) < BigInt(before[1])).slice(-Number(before[2]));
    throw new Error(`unexpected ${method} ${path}`);
  };
  const gh = async (method, path, body) => {
    if (method === "GET") return [];
    issues.push(body);
    return { number: 7, html_url: "https://github.com/o/r/issues/7" };
  };
  return { api, gh, posted, issues };
}

const said = (id, content, extra = {}) => ({ id, content, author: { id: `u${id}`, username: `p${id}` }, timestamp: "2026-11-16T10:00:00Z", ...extra });
const bugged = { reactions: [{ emoji: { name: "🐛" } }] };

test("reaction files a moderator's 🐛 message with the messages before it, oldest first", async () => {
  const server = fakeServer([said("1", "first"), said("2", "second"), said("3", "Gossip is silent", bugged), said("4", "later")]);
  await reaction(server.api, server.gh, "general", "3");
  assert.equal(server.issues.length, 1);
  assert.equal(server.issues[0].title, "Gossip is silent");
  const body = server.issues[0].body;
  assert.ok(body.includes("first") && body.includes("second"));
  assert.ok(body.indexOf("first") < body.indexOf("second"));
  assert.ok(!server.issues[0].body.includes("later"));
  assert.equal(server.posted[0].body.message_reference.message_id, "3");
});

test("reaction files nothing twice, nor for a 🐛 from someone who is not a moderator", async () => {
  const filed = { author: { bot: true }, content: "Logged on GitHub as #7", message_reference: { message_id: "3" } };
  const again = fakeServer([said("3", "Gossip is silent", bugged), said("4", "", filed)]);
  await reaction(again.api, again.gh, "general", "3");
  assert.equal(again.issues.length, 0);

  const player = fakeServer([said("3", "Gossip is silent", bugged)], { reactors: [{ id: "someone" }] });
  await reaction(player.api, player.gh, "general", "3");
  assert.equal(player.issues.length, 0);
});
