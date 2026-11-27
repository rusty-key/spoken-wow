/** Against the real database: what /listen reads and the votes it writes. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } = await import("@/lib/teams/testing");
const { forgetTeams } = await import("@/lib/teams/store");
const { asTeam } = await import("@/lib/teams/acting");
const store = await import("@/lib/voice-design/store");
const { showVersion } = await import("./showings");
const pub = await import("./public");

const SHA = (n: number) => n.toString(16).padStart(64, "0");

let lang: Awaited<ReturnType<typeof uniqueLang>>;
let main: string;
let second: string;
let user: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  main = await newTeamIn(lang, true, "main");
  second = await newTeamIn(lang, false, "second");
  forgetTeams();
  user = await testUser("voice-listen");
});

afterAll(async () => {
  for (const team of [main, second]) {
    for (const table of ["voice_feedback", "voice_design_showing", "voice_design_clip", "voice_design", "voice_design_analysis"]) {
      await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
    }
    await dropTeam(team);
  }
  await dropLang(lang);
  await user.cleanup();
  await closeDb();
});

/** A sampled version made as `team`, shown to players. */
function shown(team: string, slot: string, n: number, analysis: Record<string, unknown> | null = null) {
  return asTeam(lang, team, async () => {
    const made = await store.createDesign({
      lang,
      slot,
      prompt: "secret prompt",
      previewText: "x".repeat(120),
      previews: [{ generatedVoiceId: `gen-${n}`, sha256: SHA(n), measures: null }],
      analysisId: null,
      analysis,
      userId: user.id,
    });
    await store.saveVoice(lang, made.id, {
      chosenPreview: 0,
      voiceId: `v-${n}`,
      voiceName: "x",
      holderId: user.id,
    });
    await store.replaceSamples(
      lang,
      made.id,
      [0, 1, 2].map((position) => ({
        position,
        sha256: SHA(n * 10 + position),
        lineId: `q:${position}:accept`,
        text: `Line ${position}.`,
        npcName: "Grunt",
        characters: 7,
        credits: 3,
      })),
      { model: "m", settings: {} },
    );
    const { showingId } = await showVersion(lang, made.id, user.id);
    return { made, showingId };
  });
}

describe("the Listen page's voices", () => {
  it("lists each slot's public version of the default team, whoever is looking", async () => {
    await shown(main, "orc-male-shady", 1, { archetype: "Back-alley fence" });
    const latest = await shown(main, "orc-male-shady", 2, {
      archetype: "Smooth smuggler",
    });
    await expect(shown(second, "orc-female", 3)).rejects.toThrow(/Listen/);

    const voices = await asTeam(lang, second, () => pub.publicVoices(lang));

    expect(voices).toEqual([
      {
        slot: "orc-male-shady",
        race: "orc",
        gender: "male",
        flavor: "shady",
        archetype: "Smooth smuggler",
        showingId: latest.showingId,
        samples: [0, 1, 2].map((p) => ({
          sha256: SHA(20 + p),
          text: `Line ${p}.`,
          npcName: "Grunt",
        })),
      },
    ]);
    expect(await pub.isPublicClip(lang, SHA(20))).toBe(true);
    expect(await pub.isPublicClip(lang, SHA(10))).toBe(false);
    expect(await pub.isPublicClip(lang, SHA(2))).toBe(false);
  });

  it("keeps one vote per voter, the second replacing the first", async () => {
    const { showingId } = await shown(main, "orc-male-guard", 4);
    await pub.castVote(lang, {
      showingId,
      voter: "a:one",
      userId: null,
      verdict: "off",
      note: "too old",
    });
    await pub.castVote(lang, {
      showingId,
      voter: "a:one",
      userId: null,
      verdict: "close",
      note: "",
    });
    expect(await pub.votesOf(lang, "a:one")).toEqual({
      [showingId]: { verdict: "close", note: "" },
    });
  });

  it("refuses a vote on a showing players no longer hear", async () => {
    const old = await shown(main, "orc-male-peon", 5);
    await shown(main, "orc-male-peon", 6);
    await expect(
      pub.castVote(lang, {
        showingId: old.showingId,
        voter: "a:two",
        userId: null,
        verdict: "fits",
        note: "",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      pub.castVote(lang, {
        showingId: 999999999,
        voter: "a:two",
        userId: null,
        verdict: "fits",
        note: "",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
