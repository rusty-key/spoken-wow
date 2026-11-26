/**
 * Against the real database: importing a folder twice must leave one version, which the
 * schema's unique key decides.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/voices/slots", () => ({ isVoiceSlot: async (slot: string) => slot.startsWith("orc-male") }));
const bucket = vi.hoisted(() => ({ down: false }));
vi.mock("./audio", async (original) => {
  const actual = await original<typeof import("./audio")>();
  return {
    ...actual,
    keepDesignAudio: async (data: Buffer, lang: string) => {
      if (bucket.down && data.toString() === "l2") throw new Error("bucket unreachable");
      return actual.keepDesignAudio(data, lang as never);
    },
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-design-import-"));
process.env.SPOKEN_QUESTS_VOICE_DESIGNS = root;

const { closeDb } = await import("@/lib/db");
const { asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } = await import("@/lib/teams/testing");
const { importVersion, parseVersion } = await import("./import");
const { listDesigns } = await import("./store");

const META = {
  slot: "orc-male-shady",
  version: 2,
  name: "design-orc-male-shady-v2",
  voice_id: "1JnUt7WXW0E4mwQjQU28",
  prompt: "A lean adult male orc.",
  preview_text: "Want to make your demons more powerful?",
  preview_ids: ["a", "b", "c"],
  chosen_preview: 0,
  lines: [
    { file: "line1.mp3", npc: "Snarl", text: "Come to me again.", lineId: "g:a5954f" },
    { file: "line2.mp3", npc: "Ulathek", text: "A message?", lineId: "g:d02f82" },
  ],
  model_id: "eleven_v4",
};

const folder = (meta: object = META) => [
  { name: "voices/orc-male-shady-v2/meta.json", data: Buffer.from(JSON.stringify(meta)) },
  { name: "voices/orc-male-shady-v2/preview0.mp3", data: Buffer.from("p0") },
  { name: "voices/orc-male-shady-v2/preview1.mp3", data: Buffer.from("p1") },
  { name: "voices/orc-male-shady-v2/preview2.mp3", data: Buffer.from("p2") },
  { name: "voices/orc-male-shady-v2/line1.mp3", data: Buffer.from("l1") },
  { name: "voices/orc-male-shady-v2/line2.mp3", data: Buffer.from("l2") },
];
const REVIEWS = [
  { at: "2026-11-26 17:14", status: "needs-work", note: "Much worse", best_preview: 0, clips: {} },
  { at: "2026-11-26 17:42", status: "good", note: "", best_preview: 2, clips: { "line2.mp3": "up", "preview1.mp3": "down", ref: "up" } },
];

let lang: Awaited<ReturnType<typeof uniqueLang>>;
let team: string;
let user: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  team = await newTeamIn(lang, true);
  user = await testUser("voice-design-import");
});

afterAll(async () => {
  for (const table of ["voice_design_review", "voice_design_clip", "voice_design"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
  }
  await dropTeam(team);
  await dropLang(lang);
  await user.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("parseVersion", () => {
  it("reads the folder and its verdicts in order", () => {
    const parsed = parseVersion(folder(), REVIEWS);
    expect(parsed.previews.map(String)).toEqual(["p0", "p1", "p2"]);
    expect(parsed.lines.map((l) => [l.lineId, String(l.audio)])).toEqual([["g:a5954f", "l1"], ["g:d02f82", "l2"]]);
    expect(parsed.reviews.map((r) => r.status)).toEqual(["needs-work", "good"]);
    expect(parsed.reviews[1]).toMatchObject({ bestPreview: 2, clips: { "sample:1": "good", "preview:1": "off" }, at: "2026-11-26 17:42:00" });
  });

  it("refuses a folder without meta.json or previews", () => {
    expect(() => parseVersion(folder().slice(1), [])).toThrow(/meta.json/);
    expect(() => parseVersion(folder().filter((f) => !f.name.includes("preview")), [])).toThrow(/previews/);
  });
});

describe("importVersion", () => {
  it("creates the version once, with its voice, samples and verdicts", async () => {
    const first = await importVersion(parseVersion(folder(), REVIEWS), { lang, userId: user.id });
    const again = await importVersion(parseVersion(folder(), REVIEWS), { lang, userId: user.id });
    expect(first.id).not.toBeNull();
    expect(again.id).toBeNull();

    const design = (await listDesigns(lang)).find((d) => d.version === 2)!;
    expect(design).toMatchObject({
      slot: "orc-male-shady",
      version: 2,
      voiceId: "1JnUt7WXW0E4mwQjQU28",
      voiceName: "design-orc-male-shady-v2",
      holderId: user.id,
      chosenPreview: 0,
      sampleModel: "eleven_v4",
    });
    expect(design.samples.map((s) => s.lineId)).toEqual(["g:a5954f", "g:d02f82"]);
    expect(design.reviews.map((r) => r.status)).toEqual(["needs-work", "good"]);
  });

  it("leaves nothing behind when a file cannot be kept, so importing again completes it", async () => {
    const folder3 = folder({ ...META, version: 3 });
    bucket.down = true;
    await expect(importVersion(parseVersion(folder3, REVIEWS), { lang, userId: user.id })).rejects.toThrow(/bucket/);
    bucket.down = false;
    expect((await importVersion(parseVersion(folder3, REVIEWS), { lang, userId: user.id })).id).not.toBeNull();
    const v3 = (await listDesigns(lang)).find((d) => d.version === 3)!;
    expect(v3.samples).toHaveLength(2);
    expect(v3.reviews).toHaveLength(2);
  });

  it("records no chosen preview for a negative one", async () => {
    await importVersion(parseVersion(folder({ ...META, version: 4, chosen_preview: -1 }), []), { lang, userId: user.id });
    expect((await listDesigns(lang)).find((d) => d.version === 4)?.chosenPreview).toBeNull();
  });

  it("keeps the folder's metrics, note and analysis, and a deleted voice as deleted", async () => {
    const meta = {
      ...META,
      version: 5,
      voice_deleted: true,
      note: "Saved preview 1: softest s with little room.",
      analysis: { archetype: "Shady dealer", revision_heard: "v1 sounded noble." },
      preview_metrics: [
        { ess: 0.5, decay: -21.7, level: -12.1 },
        { ess: 0.02, decay: -20, level: -14.7 },
        { ess: 0.6, decay: -23.3, level: -14 },
      ],
    };
    const files = [
      ...folder(meta),
      // Live takes come from the site; the folder's copies are ignored, not refused.
      { name: "voices/orc-male-shady-v2/live-line1.mp3", data: Buffer.from("live") },
    ];
    await importVersion(parseVersion(files, REVIEWS), { lang, userId: user.id });
    const v5 = (await listDesigns(lang)).find((d) => d.version === 5)!;
    expect(v5.voiceDeletedAt).not.toBeNull();
    expect(v5.note).toBe("Saved preview 1: softest s with little room.");
    expect(v5.analysis).toEqual({ archetype: "Shady dealer", revision_heard: "v1 sounded noble." });
    expect(v5.previews.map((p) => p.measures)).toEqual(meta.preview_metrics);
    expect(v5.samples.map((s) => s.sha256)).not.toContain(expect.stringMatching(/live/));
  });

  it("refuses a slot not on the roster", async () => {
    await expect(importVersion(parseVersion(folder({ ...META, slot: "elf-male-x" }), []), { lang, userId: user.id })).rejects.toThrow(/elf-male-x/);
  });
});
