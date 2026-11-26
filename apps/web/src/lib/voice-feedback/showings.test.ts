/**
 * Against the real database: which version is public, the lock and the counts live in queries
 * over the showing and feedback tables.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } = await import("@/lib/teams/testing");
const store = await import("@/lib/voice-design/store");
const showings = await import("./showings");

const SHA = (n: number) => n.toString(16).padStart(64, "0");

let lang: Awaited<ReturnType<typeof uniqueLang>>;
let team: string;
let user: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  team = await newTeamIn(lang, true);
  user = await testUser("voice-feedback");
});

afterAll(async () => {
  for (const table of ["voice_feedback", "voice_design_showing", "voice_design_review", "voice_design_clip", "voice_design"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
  }
  await dropTeam(team);
  await dropLang(lang);
  await user.cleanup();
  await closeDb();
});

/** A version with its voice saved and one sample line, ready to show. */
async function sampled(slot: string, n: number) {
  const made = await store.createDesign({
    lang,
    slot,
    prompt: "A gruff orc.",
    previewText: "x".repeat(120),
    previews: [{ generatedVoiceId: `gen-${n}`, sha256: SHA(n), measures: null }],
    analysisId: null,
    userId: user.id,
  });
  await store.saveVoice(lang, made.id, { chosenPreview: 0, voiceId: `v-${n}`, voiceName: `design-${slot}-v${made.version}`, holderId: user.id });
  await store.replaceSamples(lang, made.id, [
    { position: 0, sha256: SHA(n + 100), lineId: "q:1:accept", text: "Hello.", npcName: "Grunt", characters: 6, credits: 3 },
  ], { model: "eleven_v4", settings: {} });
  return made;
}

describe("showing a version to players", () => {
  it("refuses a version with no sample lines", async () => {
    const bare = await store.createDesign({
      lang,
      slot: "orc-male-bare",
      prompt: "p",
      previewText: "x".repeat(120),
      previews: [],
      analysisId: null,
      userId: user.id,
    });
    await expect(showings.showVersion(lang, bare.id, user.id)).rejects.toThrow(/sample/i);
  });

  it("makes the newest showing public, and an older version shown again is a rollback", async () => {
    const one = await sampled("orc-male-shady", 1);
    const two = await sampled("orc-male-shady", 2);
    expect((await showings.showVersion(lang, one.id, user.id)).replaced).toBe(false);
    expect((await showings.showVersion(lang, two.id, user.id)).replaced).toBe(true);
    expect((await store.readDesign(lang, one.id))!.isPublic).toBe(false);
    expect((await store.readDesign(lang, two.id))!.isPublic).toBe(true);
    await showings.showVersion(lang, one.id, user.id);
    expect((await store.readDesign(lang, one.id))!.isPublic).toBe(true);
    expect((await store.readDesign(lang, one.id))!.showings).toHaveLength(2);
  });

  it("locks a public version's lines until another version is shown", async () => {
    const one = await sampled("orc-male-guard", 3);
    const two = await sampled("orc-male-guard", 4);
    await showings.showVersion(lang, one.id, user.id);
    await expect(store.replaceSamples(lang, one.id, [], { model: "m", settings: {} })).rejects.toThrow(/players hear/i);
    await expect(
      store.saveVoice(lang, one.id, { chosenPreview: 0, voiceId: "v-x", voiceName: "x", holderId: user.id }),
    ).rejects.toThrow(/players hear/i);
    await showings.showVersion(lang, two.id, user.id);
    await expect(store.replaceSamples(lang, one.id, [], { model: "m", settings: {} })).resolves.toBeUndefined();
  });

  it("counts every verdict, and leaves a hidden note out of the list", async () => {
    const one = await sampled("orc-male-peon", 5);
    const { showingId } = await showings.showVersion(lang, one.id, user.id);
    await asSystem.query(
      `insert into "voice_feedback" ("showingId", "teamId", "voter", "userId", "verdict", "note") values
         ($1, $2, $3, $4, 'off', 'too old'), ($1, $2, 'a:spam', null, 'fits', 'buy gold'), ($1, $2, 'a:quiet', null, 'skip', '')`,
      [showingId, team, `u:${user.id}`, user.id],
    );
    expect(await showings.hideNote(lang, showingId, "a:spam")).toBe(true);
    const [showing] = (await store.readDesign(lang, one.id))!.showings;
    expect(showing.counts).toEqual({ fits: 1, close: 0, off: 1, skip: 1 });
    expect(showing.notes).toEqual([expect.objectContaining({ voter: `u:${user.id}`, verdict: "off", note: "too old", who: expect.any(String) })]);
  });
});
