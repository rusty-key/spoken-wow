/** Against the real database: who hears that a voice changed, and how often. */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChangedVoice } from "./follow";

vi.mock("server-only", () => ({}));

const { closeDb } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } = await import("@/lib/teams/testing");
const store = await import("@/lib/voice-design/store");
const { showVersion } = await import("./showings");
const { castVote } = await import("./public");
const follow = await import("./follow");

const SHA = (n: number) => n.toString(16).padStart(64, "0");
const tag = randomUUID().slice(0, 8);
const mail = (name: string) => `${name}-${tag}@example.invalid`;

let lang: Awaited<ReturnType<typeof uniqueLang>>;
let team: string;
let user: Awaited<ReturnType<typeof testUser>>;
let quitter: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  team = await newTeamIn(lang, true);
  user = await testUser("voice-follow");
  quitter = await testUser("voice-quit");
});

afterAll(async () => {
  await asSystem.query(`delete from "voice_follow_notice" where "email" like $1`, [`%${tag}%`]);
  await asSystem.query(`delete from "voice_follow_notice" where "email" = any($1)`, [[`${user.id}@example.invalid`, `${quitter.id}@example.invalid`]]);
  await asSystem.query(`delete from "voice_follow_optout" where "email" like $1 or "email" = $2`, [`%${tag}%`, `${quitter.id}@example.invalid`]);
  await asSystem.query(`delete from "voice_follower" where "email" like $1`, [`%${tag}%`]);
  for (const table of ["voice_feedback", "voice_design_showing", "voice_design_clip", "voice_design"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
  }
  await dropTeam(team);
  await dropLang(lang);
  await user.cleanup();
  await quitter.cleanup();
  await closeDb();
});

async function sampledVersion(slot: string, n: number) {
  const made = await store.createDesign({
    lang, slot, prompt: "p", previewText: "x".repeat(120),
    previews: [{ generatedVoiceId: `g-${n}`, sha256: SHA(n), measures: null }], analysisId: null, userId: user.id,
  });
  await store.saveVoice(lang, made.id, { chosenPreview: 0, voiceId: `v-${n}`, voiceName: "x", holderId: user.id });
  await store.replaceSamples(lang, made.id, [
    { position: 0, sha256: SHA(n + 500), lineId: "q:1:accept", text: "Hi.", npcName: null, characters: 3, credits: 1 },
  ], { model: "m", settings: {} });
  return made;
}

/** An anonymous voter whose address is confirmed. */
async function confirmedFollower(name: string): Promise<string> {
  const voter = `a:${randomUUID()}`;
  const sent: string[] = [];
  await follow.requestFollow(voter, mail(name), new Date(), async (_to, url) => {
    sent.push(url);
    return true;
  });
  const token = new URL(sent[0]).searchParams.get("token")!;
  expect(await follow.confirmFollow(token)).toBe(true);
  return voter;
}

describe("following a voice", () => {
  it("tells the voters of an earlier round, not skippers, unconfirmed addresses or those who unsubscribed", async () => {
    const first = await sampledVersion("orc-male-shady", 1);
    const { showingId } = await showVersion(lang, first.id, user.id);
    const fan = await confirmedFollower("fan");
    const skipper = await confirmedFollower("skipper");
    const unconfirmed = `a:${randomUUID()}`;
    await follow.requestFollow(unconfirmed, mail("unconfirmed"), new Date(), async () => true);
    await follow.unsubscribe(`${quitter.id}@example.invalid`);

    await castVote(lang, { showingId, voter: `u:${user.id}`, userId: user.id, verdict: "off", note: "too old" });
    await castVote(lang, { showingId, voter: fan, userId: null, verdict: "close", note: "" });
    await castVote(lang, { showingId, voter: skipper, userId: null, verdict: "skip", note: "" });
    await castVote(lang, { showingId, voter: unconfirmed, userId: null, verdict: "fits", note: "" });
    await castVote(lang, { showingId, voter: `u:${quitter.id}`, userId: quitter.id, verdict: "fits", note: "" });

    const second = await sampledVersion("orc-male-shady", 2);
    await showVersion(lang, second.id, user.id);

    const sent: { to: string; voices: ChangedVoice[] }[] = [];
    const send = async (to: string, voices: ChangedVoice[]) => {
      sent.push({ to, voices });
      return true;
    };
    const now = new Date();
    await follow.sendDue(now, send);
    const mine = sent.filter((s) => s.to.includes(tag) || s.to.startsWith(user.id) || s.to.startsWith(quitter.id));
    expect(mine.map((s) => s.to).sort()).toEqual([`${user.id}@example.invalid`, mail("fan")].sort());
    expect(mine[0].voices).toEqual([{ lang, slot: "orc-male-shady" }]);

    // A third version the same day waits for tomorrow's email.
    const third = await sampledVersion("orc-male-shady", 3);
    await showVersion(lang, third.id, user.id);
    sent.length = 0;
    await follow.sendDue(new Date(now.getTime() + 60 * 60 * 1000), send);
    expect(sent.filter((s) => s.to === mail("fan"))).toEqual([]);
    await follow.sendDue(new Date(now.getTime() + 25 * 60 * 60 * 1000), send);
    expect(sent.filter((s) => s.to === mail("fan"))).toHaveLength(1);
  });

  it("sends a confirmation once an hour at most, and confirms by its link", async () => {
    const voter = `a:${randomUUID()}`;
    const urls: string[] = [];
    const send = async (_to: string, url: string) => {
      urls.push(url);
      return true;
    };
    const now = new Date();
    expect(await follow.requestFollow(voter, mail("Once"), now, send)).toBe("sent");
    expect(await follow.requestFollow(voter, mail("once"), new Date(now.getTime() + 60_000), send)).toBe("wait");
    expect(urls).toHaveLength(1);
    expect(await follow.followState(voter, null)).toEqual({ kind: "anonymous", email: mail("once"), confirmed: false });
    expect(await follow.confirmFollow(new URL(urls[0]).searchParams.get("token")!)).toBe(true);
    expect(await follow.followState(voter, null)).toEqual({ kind: "anonymous", email: mail("once"), confirmed: true });
  });

  it("signs unsubscribe links, so nobody can unsubscribe someone else", () => {
    const url = new URL(follow.unsubscribeUrl("Someone@Example.invalid"));
    expect(follow.verifyUnsubscribe(url.searchParams.get("email")!, url.searchParams.get("sig")!)).toBe(true);
    expect(follow.verifyUnsubscribe("other@example.invalid", url.searchParams.get("sig")!)).toBe(false);
  });
});
