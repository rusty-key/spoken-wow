/**
 * Against the real database: the version numbers, the team a version belongs to and the order
 * of verdicts live in the schema and its row-level security.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } = await import("@/lib/teams/testing");
const store = await import("./store");

const SHA = (n: number) => n.toString(16).padStart(64, "0");
const preview = (n: number) => ({ generatedVoiceId: `gen-${n}`, sha256: SHA(n), measures: null });

let lang: Awaited<ReturnType<typeof uniqueLang>>;
let other: Awaited<ReturnType<typeof uniqueLang>>;
let teams: string[] = [];
let user: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  other = await uniqueLang();
  teams = [await newTeamIn(lang, true), await newTeamIn(other, true)];
  user = await testUser("voice-design");
});

afterAll(async () => {
  for (const team of teams) {
    for (const table of ["voice_design_review", "voice_design_clip", "voice_design", "voice_design_analysis"]) {
      await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
    }
    await dropTeam(team);
  }
  await dropLang(lang);
  await dropLang(other);
  await user.cleanup();
  await closeDb();
});

const design = (slot = "orc-male-shady") =>
  store.createDesign({
    lang,
    slot,
    prompt: "A gruff orc.",
    previewText: "x".repeat(120),
    previews: [preview(1), preview(2), preview(3)],
    analysisId: null,
    userId: user.id,
  });

describe("a design version", () => {
  it("numbers versions per slot, one after another", async () => {
    const first = await design();
    const second = await design();
    const guard = await design("orc-male-guard");
    expect([first.version, second.version, guard.version]).toEqual([1, 2, 1]);
    expect(second.previews.map((p) => p.sha256)).toEqual([SHA(1), SHA(2), SHA(3)]);
  });

  it("never gives two designs made at once the same number", async () => {
    const made = await Promise.all([design("orc-male-standard"), design("orc-male-standard"), design("orc-male-standard")]);
    expect(made.map((d) => d.version).sort()).toEqual([1, 2, 3]);
  });

  it("keeps verdicts in order, the newest last", async () => {
    const made = await design("orc-female");
    await store.addReview(lang, made.id, { status: "needs-work", note: "sounds wise", bestPreview: 1, clips: { "sample:0": "off" }, userId: user.id });
    await store.addReview(lang, made.id, { status: "good", note: "", bestPreview: null, clips: {}, userId: user.id });
    const read = await store.readDesign(lang, made.id);
    expect(read?.reviews.map((r) => r.status)).toEqual(["needs-work", "good"]);
    expect(read?.reviews[0]).toMatchObject({ note: "sounds wise", bestPreview: 1, clips: { "sample:0": "off" } });
  });

  it("records the saved voice, its samples and its deletion", async () => {
    const made = await design("orc-male-grunt");
    await store.saveVoice(lang, made.id, { chosenPreview: 2, voiceId: "v-1", voiceName: "design-orc-male-grunt-v1", holderId: user.id });
    await store.replaceSamples(lang, made.id, [
      { position: 0, sha256: SHA(9), lineId: "q:1:accept", text: "Hello.", npcName: "Grunt", characters: 6, credits: 3 },
    ], { model: "eleven_v4", settings: { stability: 0.5 } });
    await store.markVoiceDeleted(lang, made.id);
    const read = (await store.readDesign(lang, made.id))!;
    expect(read).toMatchObject({ chosenPreview: 2, voiceId: "v-1", holderId: user.id, sampleModel: "eleven_v4" });
    expect(read.voiceDeletedAt).not.toBeNull();
    expect(read.samples).toEqual([expect.objectContaining({ lineId: "q:1:accept", sha256: SHA(9) })]);
    expect(await store.isDesignAudio(lang, SHA(9))).toBe(true);
    expect(await store.isDesignAudio(other, SHA(9))).toBe(false);
  });

  it("is the team's: another language's team sees none of them", async () => {
    expect((await store.listDesigns(lang)).length).toBeGreaterThan(0);
    expect(await store.listDesigns(other)).toEqual([]);
  });
});

describe("an analysis", () => {
  it("is read back newest first per group", async () => {
    const base = { lang, labels: { A: "orc-male-shady" }, measurements: null, model: "gemini", userId: user.id };
    await store.saveAnalysis({ ...base, group: "orc-male", result: { voices: {} } });
    const newer = await store.saveAnalysis({ ...base, group: "orc-male", result: { voices: {}, same_actor_guess: "none" } });
    const latest = await store.latestAnalyses(lang);
    expect(latest.get("orc-male")?.id).toBe(newer.id);
  });
});
