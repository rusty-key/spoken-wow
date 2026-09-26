/**
 * The whole regeneration path, against a real Postgres and a stub ElevenLabs.
 *
 * Real database for the reason history.test.ts gives; stub ElevenLabs because a test that
 * spends a month's characters to prove it can spend a month's characters is not a test the
 * project can afford to run on every commit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-regen-"));
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { historyDirOf } = await import("@/lib/takes/adapters");
const historyDir = (file: string) => historyDirOf("quests", file);
const { archiveName } = await import("@/lib/takes/bytes");
const { listTakes } = await import("@/lib/takes/store");
const { regenerateLine } = await import("./regenerate");
const { elevenLabsSpeaker } = await import("./speakers/elevenlabs");
const { defaultElevenLabs } = await import("./preference");
const { LEAD_IN } = await import("./leadin");
const { audioRelPath } = await import("@/lib/audio");
const { lineIndex } = await import("@/lib/quests/catalogue");
const { clearOverride, writeOverride } = await import("@/lib/quests/overrides");

/** A quest line one NPC speaks. Jitters, human-male, in Deadwind Pass. */
const SOLO = "q:5:accept";
/** A quest line six NPCs share, so one file serves all of them. Lowest npcId is 233. */
const SHARED = "q:109:accept";
/** A dwarf line: "Hiccup! Ho Ho!", spoken by Grimand Elmore. The race with an accent tag. */
const DWARF = "q:48:complete";
/** Progress text, voiced like any other line. */
const PROGRESS = "q:6:progress";
/** A whole line of stage direction: "<Sirra begins translating…>". The narrator reads it. */
const STAGE_DIRECTION = "q:251:complete";
/**
 * A bracket Blizzard left behind - "Well done, Adventurer>." - so only an override rescues it.
 *
 * Not one of the $2113w war-effort lines, which read the same way here but are ignored
 * outright by migration 0017: those are refused for being ignored, before the gate is asked.
 */
const TEMPLATE_TOKEN = "q:7124:complete";
/** One of those war-effort lines, seeded as ignored. */
const IGNORED = "q:8514:accept:m";

const MP3 = Buffer.from("ID3generated-audio");

type StubOptions = {
  voices?: Record<string, string>;
  speech?: () => Response;
};

/** Stands in for the three ElevenLabs endpoints this path touches. */
const DEFAULT_VOICES = {
  "human-male-standard": "voice-human-male-standard",
  // The shared line's six NPCs are all officials; the solo one is a standard.
  "human-male-official": "voice-human-male-official",
  // The line holding a stray bracket, which an override rescues.
  "orc-female-warrior": "voice-orc-female-warrior",
  // Not a race-gender-flavor slot: it reads stage directions, and no corpus line names it.
  "narrator-male": "voice-narrator-male",
  // The dwarf line, which the committed race tags give an accent direction.
  "dwarf-male-grim": "voice-dwarf-male-grim",
};

function stub({ voices = DEFAULT_VOICES, speech }: StubOptions = {}) {
  const calls: { url: string; body?: unknown }[] = [];

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.endsWith("/v1/voices")) {
      return Response.json({
        voices: Object.entries(voices).map(([name, voice_id]) => ({ name, voice_id })),
      });
    }
    if (url.endsWith("/v1/user/subscription")) {
      return Response.json({ tier: "creator", character_count: 100, character_limit: 131000 });
    }
    if (url.endsWith("/v1/models")) {
      return Response.json([
        { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
      ]);
    }
    if (url.endsWith("/v1/text-to-dialogue")) {
      return speech
        ? speech()
        : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.includes("/v1/text-to-speech/")) {
      return speech
        ? speech()
        : new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`stub got an unexpected url: ${url}`);
  });

  return {
    calls,
    options: {
      speaker: elevenLabsSpeaker({
        apiKey: "test-key",
        baseUrl: "https://stub.invalid",
        fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
        settings: defaultElevenLabs(),
      }),
    },
  };
}

async function fileFor(lineId: string): Promise<string> {
  return audioRelPath((await lineIndex()).get(lineId)![0]);
}

/**
 * Rows this test displaced, put back when it finishes.
 *
 * This test has to use real corpus lineIds - it is testing that a real line resolves, seeds
 * and writes correctly - so the files it touches are the real ones, and `pnpm test` runs
 * against DATABASE_URL, which is usually a developer's own database. It needs a clean slate
 * to assert on, and it must not be the thing that clears it permanently. So the fixtures'
 * rows are lifted out before each test and put back after.
 */
const FIXTURE_LINES = [SOLO, SHARED, PROGRESS, STAGE_DIRECTION, TEMPLATE_TOKEN, DWARF];
let displaced: Record<string, unknown>[] = [];

async function fixtureFiles(): Promise<string[]> {
  return Promise.all(FIXTURE_LINES.map((line) => fileFor(line)));
}

beforeEach(async () => {
  fs.mkdirSync(path.join(root, "audio", "quests"), { recursive: true });
  fs.mkdirSync(path.join(root, "audio", "gossip"), { recursive: true });

  const files = await fixtureFiles();
  const { rows } = await db().query(
    `delete from "take" where "file" = any($1::text[]) returning *`,
    [files],
  );
  displaced = rows;
});

afterEach(async () => {
  const files = await fixtureFiles();
  await db().query(`delete from "take" where "file" = any($1::text[])`, [files]);

  for (const row of displaced) {
    const columns = Object.keys(row).filter((key) => key !== "id");
    await db().query(
      `insert into "take" (${columns.map((c) => `"${c}"`).join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        // jsonb comes back parsed and has to go in as text again.
        return value !== null && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );
  }
  displaced = [];

  fs.rmSync(path.join(root, "audio"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "audio-history"), { recursive: true, force: true });
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

async function regenerate(lineId: string, options: ReturnType<typeof stub>["options"]) {
  return regenerateLine(lineId, null as unknown as string, options);
}

describe("a line with no audio yet", () => {
  it("generates it and archives it as version 1", async () => {
    const { options, calls } = stub();

    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toBe("quests/5-accept.mp3");
    expect(result.version).toBe(1);
    expect(result.voice).toBe("human-male-standard");
    expect(result.voiceId).toBe("voice-human-male-standard");
    expect(fs.readFileSync(path.join(historyDir(result.file), archiveName(1, MP3)))).toEqual(MP3);

    const speech = calls.find((call) => call.url.includes("text-to-speech"))!;
    expect(speech.url).toBe("https://stub.invalid/v1/text-to-speech/voice-human-male-standard");
  });

  // The lead-in is the one thing sent that the take does NOT record: it is a constant, it
  // says nothing about the line, and counting it would make every take in the corpus stale
  // the day it was introduced.
  it("counts the characters it actually spoke, and not the lead-in", async () => {
    const { options, calls } = stub();
    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spoken = (calls.find((c) => c.url.includes("text-to-speech"))!.body as { text: string })
      .text;
    expect(spoken).toBe(`${LEAD_IN}${result.spokenText}`);
    expect(result.characters).toBe(result.spokenText.length);
  });
});

describe("a race with an accent tag", () => {
  it("sends the direction ahead of the words", async () => {
    const { options, calls } = stub();

    const result = await regenerate(DWARF, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const speech = calls.find((call) => call.url.includes("text-to-speech"))!;
    expect((speech.body as { text: string }).text).toBe(
      `${LEAD_IN}[Scottish accent] Hiccup! Ho Ho!`,
    );
  });

  // The tag is text ElevenLabs bills for and text the staleness check hashes, so a take that
  // under-reports it would be both mispriced and permanently stale.
  it("records the tag in the spoken text it bills for", async () => {
    const { options } = stub();

    const result = await regenerate(DWARF, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spokenText).toBe("[Scottish accent] Hiccup! Ho Ho!");
    expect(result.characters).toBe("[Scottish accent] Hiccup! Ho Ho!".length);
  });

  it("leaves a race with no tag exactly as it was", async () => {
    const { options, calls } = stub();

    await regenerate(SOLO, options);

    const speech = calls.find((call) => call.url.includes("text-to-speech"))!;
    const sent = (speech.body as { text: string }).text;
    // Past the lead-in, which every v3 request carries and which is not an accent tag.
    expect(sent.slice(LEAD_IN.length).startsWith("[")).toBe(false);
  });
});

describe("a line whose audio already exists", () => {
  it("adds a take beside the one it replaces, and changes neither file", async () => {
    const file = await fileFor(SOLO);

    const { options } = stub();
    const first = await regenerate(SOLO, options);
    expect(first.ok).toBe(true);

    const second = await regenerate(SOLO, stub().options);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.version).toBe(2);
    expect(fs.readdirSync(historyDir(file)).sort()).toEqual(
      [archiveName(1, MP3), archiveName(2, MP3)].sort(),
    );
    const takes = await listTakes("quests", file);
    expect(takes.map((t) => [t.version, t.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
  });
});

/**
 * The reason canonicalNpcId exists. Six NPCs speak q:109:accept and share one mp3, so the
 * seed must not depend on which of them the button was pressed for - Python's seeds from
 * whichever row it happened to process.
 */
describe("a line several NPCs share", () => {
  it("seeds from the lowest npcId, and says how many others are affected", async () => {
    const { options, calls } = stub();

    const result = await regenerate(SHARED, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sharedWith).toBe(5);

    // zlib.crc32("233"), the lowest of the six.
    const { default: zlib } = await import("node:zlib");
    expect(result.seed).toBe(zlib.crc32("233"));
    expect((calls.find((c) => c.url.includes("text-to-speech"))!.body as { seed: number }).seed).toBe(
      result.seed,
    );
  });
});

describe("refusals that cost nothing", () => {
  it("404s a lineId the corpus does not have", async () => {
    const { options, calls } = stub();
    const result = await regenerateLine("q:999999:accept", "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses a line the generator never voices, without calling out", async () => {
    const { options, calls } = stub();
    const result = await regenerateLine(TEMPLATE_TOKEN, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(409);
    expect(result.failure.message).toContain("never voiced");
    // One bad line must not abandon the batch around it.
    expect(result.failure.fatal).toBe(false);
    expect(calls).toHaveLength(0);
  });

  // The common case today: three of twenty voices exist, so most lines cannot be generated
  // at all. Spending a request to be told so would be pure waste.
  it("refuses a line whose voice does not exist, and points at /voices", async () => {
    const { options, calls } = stub({ voices: { "dwarf-male": "voice-dwarf" } });

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("voice-missing");
    expect(result.failure.status).toBe(409);
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("human-male-standard");
    expect(result.failure.message).toContain("/voices");
    expect(calls.some((call) => call.url.includes("text-to-speech"))).toBe(false);
  });
});

describe("when ElevenLabs refuses", () => {
  it("passes the credit failure through as a stopping condition", async () => {
    const { options } = stub({
      speech: () =>
        new Response(
          JSON.stringify({ detail: { status: "quota_exceeded", message: "0 credits left" } }),
          { status: 401 },
        ),
    });

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota");
    expect(result.failure.status).toBe(402);
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("0 credits left");
  });

  // The property that makes a failed regeneration safe: the line still plays what it played
  // before, and nothing has been recorded that suggests otherwise.
  it("writes no file and no row", async () => {
    const file = await fileFor(SOLO);

    const { options } = stub({ speech: () => new Response("nope", { status: 500 }) });
    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    expect(fs.existsSync(historyDir(file))).toBe(false);
    expect(await listTakes("quests", file)).toEqual([]);
  });
});

/**
 * Overrides live in Postgres, so these write real rows and take them out again - the same
 * arrangement the fixture lines use, and for the same reason.
 */
describe("a line whose spoken text has been rewritten", () => {
  afterEach(async () => {
    await clearOverride(await fileFor(SOLO), null);
    await clearOverride(await fileFor(STAGE_DIRECTION), null);
    await clearOverride(await fileFor(PROGRESS), null);
    await clearOverride(await fileFor(TEMPLATE_TOKEN), null);
  });

  it("speaks the rewrite rather than what the corpus says", async () => {
    const { options, calls } = stub();
    await writeOverride(await fileFor(SOLO), SOLO, "Say this instead.", null);

    const result = await regenerate(SOLO, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sent = calls.find((c) => c.url.includes("text-to-speech"))!.body as { text: string };
    expect(sent.text).toBe(`${LEAD_IN}Say this instead.`);
    expect(result.spokenText).toBe("Say this instead.");
    // Billed for what was sent, so the version row is not describing a different take.
    expect(result.characters).toBe("Say this instead.".length);
  });

  it("voices a line the corpus had given up on, once the template token is gone", async () => {
    const { options } = stub();

    // Untouched, it holds a $ token the game expands and we do not.
    const before = await regenerateLine(TEMPLATE_TOKEN, "user", options);
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.failure.message).toContain("rewrite it");

    await writeOverride(await fileFor(TEMPLATE_TOKEN), TEMPLATE_TOKEN, "Well done, adventurer.", null);
    const after = await regenerate(TEMPLATE_TOKEN, options);

    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.spokenText).toBe("Well done, adventurer.");
  });

  it("refuses an ignored line, and says which decision refused it", async () => {
    const { options, calls } = stub();

    const result = await regenerateLine(IGNORED, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.message).toContain("war-effort tally");
    // Refused before the account is asked anything, so an ignored line costs no request.
    expect(calls).toEqual([]);
  });

  it("sends a stage direction to the narrator, as dialogue", async () => {
    const { options, calls } = stub();

    const result = await regenerate(STAGE_DIRECTION, options);
    expect(result.ok).toBe(true);

    // The dialogue endpoint, not text-to-speech: two voices, one file.
    const dialogue = calls.find((call) => call.url.endsWith("/v1/text-to-dialogue"));
    expect(dialogue).toBeDefined();
    expect(calls.some((call) => call.url.includes("/v1/text-to-speech/"))).toBe(false);

    const body = dialogue!.body as {
      inputs: { text: string; voice_id: string }[];
      settings: Record<string, unknown>;
    };
    // The whole line is a direction, so there is one turn and the narrator speaks it, with
    // the brackets stripped rather than read aloud.
    // The lead-in rides on the first turn: the ramp-up happens once, at the top of the file.
    expect(body.inputs).toEqual([
      {
        text: `${LEAD_IN}Sirra begins translating the note...`,
        voice_id: "voice-narrator-male",
      },
    ]);
    // Only stability: the endpoint documents nothing else, so nothing else is claimed.
    expect(body.settings).toEqual({ stability: expect.any(Number) });
  });

  it("records the narrator against the take", async () => {
    const { options } = stub();
    await regenerate(STAGE_DIRECTION, options);

    const { rows } = await db().query<{ narratorVoice: string | null; settings: unknown }>(
      `select "narratorVoice", "settings" from "take" where "file" = $1`,
      [await fileFor(STAGE_DIRECTION)],
    );
    expect(rows[0].narratorVoice).toBe("narrator-male");
    expect(rows[0].settings).toEqual({ stability: expect.any(Number) });
  });

  it("leaves an ordinary line on text-to-speech", async () => {
    const { options, calls } = stub();
    await regenerate(SOLO, options);

    expect(calls.some((call) => call.url.includes("/v1/text-to-speech/"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/v1/text-to-dialogue"))).toBe(false);
  });

  it("voices progress text like any other line", async () => {
    const { options, calls } = stub();
    await writeOverride(await fileFor(PROGRESS), PROGRESS, "perfectly ordinary text", null);

    const result = await regenerate(PROGRESS, options);

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.url.includes("/v1/text-to-speech/"))).toBe(true);
  });

  it("refuses a rewrite that puts the offending characters back", async () => {
    const { options, calls } = stub();
    await writeOverride(await fileFor(SOLO), SOLO, "Meet me in $B Ironforge", null);

    const result = await regenerateLine(SOLO, "user", options);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(409);
    expect(calls).toHaveLength(0);
  });
});
