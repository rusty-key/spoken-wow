import { decode } from "@msgpack/msgpack";
import { describe, expect, it, vi } from "vitest";

import {
  buildFishPayload,
  fishSpeech,
  fishText,
  paragraphs,
  PARAGRAPH_PAUSE_SEC,
  readTimedStream,
  type FishSpeechRequest,
} from "./fish-tts";

const NPC = { audio: Buffer.from("npc-clip"), text: "Well met, traveller." };
const NARRATOR = { audio: Buffer.from("narrator-clip"), text: "The dwarf nods." };
const SETTINGS = { model: "s2.1-pro-free", temperature: 0.7, topP: 0.7, speed: 1 };

const SOLO: FishSpeechRequest = {
  turns: [{ text: "Hiccup! Ho ho!", speaker: 0 }],
  references: [NPC],
  settings: SETTINGS,
};

const DIALOGUE: FishSpeechRequest = {
  turns: [
    { text: "Take this to Ironforge.", speaker: 0 },
    { text: "He hands you a letter.", speaker: 1 },
  ],
  references: [NPC, NARRATOR],
  settings: SETTINGS,
};

const OPTIONS = { apiKey: "fish-key", baseUrl: "https://stub.invalid" };

function stub(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

type Segment = { text: string; start: number; end: number };
type StreamEvent = {
  audio: string;
  seq?: number;
  offset?: number;
  segments?: Segment[] | null;
  duration?: number;
};

/** fish.audio's with-timestamp answer: one SSE `message` per audio chunk. */
function sse(events: StreamEvent[]): string {
  return events
    .map(({ audio, seq = 0, offset = 0, segments = null, duration = 1 }) => {
      const payload = {
        audio_base64: Buffer.from(audio).toString("base64"),
        content: "",
        alignment: segments ? { segments, audio_duration: duration } : null,
        chunk_seq: seq,
        chunk_audio_offset_sec: offset,
      };
      return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    })
    .join("");
}

const stream = (events: StreamEvent[]) =>
  new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });

const audio = () =>
  stream([{ audio: "ID3fish-mp3", segments: [{ text: "Hiccup", start: 0.1, end: 0.4 }] }]);

describe("the text fish.audio is sent", () => {
  it("is bare for one speaker", () => {
    expect(fishText(SOLO)).toBe("Hiccup! Ho ho!");
  });

  it("tags every turn, the first included, for several", () => {
    expect(fishText(DIALOGUE)).toBe(
      "<|speaker:0|>Take this to Ironforge.<|speaker:1|>He hands you a letter.",
    );
  });
});

describe("the payload", () => {
  it("carries one speaker's references as a flat list, with no reference_id", () => {
    const payload = buildFishPayload(SOLO);
    expect(payload.references).toEqual([NPC]);
    expect(payload).not.toHaveProperty("reference_id");
  });

  it("carries several speakers' as a list per speaker, still with no reference_id", () => {
    // fish.audio resolves any reference_id as a saved model: ["0", "1"] is a 400.
    const payload = buildFishPayload(DIALOGUE);
    expect(payload.references).toEqual([[NPC], [NARRATOR]]);
    expect(payload).not.toHaveProperty("reference_id");
  });

  it("asks for the format ElevenLabs returns, at quality latency", () => {
    expect(buildFishPayload(SOLO)).toMatchObject({
      format: "mp3",
      sample_rate: 44100,
      mp3_bitrate: 128,
      latency: "normal",
      temperature: 0.7,
      top_p: 0.7,
      prosody: { speed: 1 },
    });
  });
});

describe("a request", () => {
  it("is msgpack to the timed endpoint, with the key as a bearer and the model as a header", async () => {
    const { calls, fetchImpl } = stub(audio());
    const result = await fishSpeech(SOLO, { ...OPTIONS, fetchImpl });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("https://stub.invalid/v1/tts/stream/with-timestamp");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fish-key");
    expect(headers["Content-Type"]).toBe("application/msgpack");
    expect(headers.model).toBe("s2.1-pro-free");

    // Binary survives the round trip as bytes, which is the point of msgpack here.
    const body = decode(calls[0].init.body as Uint8Array) as { references: { audio: Uint8Array }[] };
    expect(Buffer.from(body.references[0].audio).toString()).toBe("npc-clip");
  });

  it("reports the bytes it is billed for, tags included and counted as UTF-8", async () => {
    const { fetchImpl } = stub(audio());
    const russian = { ...SOLO, turns: [{ text: "Привет", speaker: 0 }] };
    const result = await fishSpeech(russian, { ...OPTIONS, fetchImpl });
    expect(result.ok && result.bytes).toBe(12);

    const dialogue = await fishSpeech(DIALOGUE, { ...OPTIONS, fetchImpl: stub(audio()).fetchImpl });
    expect(dialogue.ok && dialogue.bytes).toBe(Buffer.byteLength(fishText(DIALOGUE)));
  });

  it("is refused without a key, before anything is sent", async () => {
    const { calls, fetchImpl } = stub(audio());
    const result = await fishSpeech(SOLO, { baseUrl: OPTIONS.baseUrl, fetchImpl });
    expect(result.ok || result.failure.kind).toBe("auth");
    expect(calls).toHaveLength(0);
  });
});

describe("a failure", () => {
  const failing = async (status: number, body: string) =>
    fishSpeech(SOLO, {
      ...OPTIONS,
      fetchImpl: stub(new Response(body, { status })).fetchImpl,
    });

  it("keeps fish.audio's message", async () => {
    const result = await failing(402, JSON.stringify({ status: 402, message: "Insufficient balance" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota");
    expect(result.failure.fatal).toBe(true);
    expect(result.failure.message).toContain("Insufficient balance");
  });

  it.each([
    [401, "auth", true],
    [429, "rate-limit", false],
    [503, "rate-limit", false],
    [400, "bad-request", false],
    [500, "upstream", false],
  ])("%i is %s", async (status, kind, fatal) => {
    const result = await failing(status, JSON.stringify({ status, message: "no" }));
    expect(result.ok || [result.failure.kind, result.failure.fatal]).toEqual([kind, fatal]);
  });

  it("includes a 200 that is not an event stream, which would otherwise be archived as silence", async () => {
    const result = await fishSpeech(SOLO, {
      ...OPTIONS,
      fetchImpl: stub(Response.json({ message: "queued" })).fetchImpl,
    });
    expect(result.ok || result.failure.kind).toBe("upstream");
  });

  it("includes a stream with no audio in it", async () => {
    const empty = new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    const result = await fishSpeech(SOLO, { ...OPTIONS, fetchImpl: stub(empty).fetchImpl });
    expect(result.ok || result.failure.kind).toBe("upstream");
  });
});

describe("a line of several paragraphs", () => {
  const BROKEN: FishSpeechRequest = {
    turns: [
      { text: "Take this to Ironforge.\nMind the road.", speaker: 0 },
      { text: "He hands you a letter.", speaker: 1 },
      { text: "Go.", speaker: 0 },
    ],
    references: [NPC, NARRATOR],
    settings: SETTINGS,
  };

  it("is one request per paragraph, each with only the voices it uses", () => {
    const parts = paragraphs(BROKEN);
    expect(parts.map((part) => part.turns)).toEqual([
      [{ text: "Take this to Ironforge.", speaker: 0 }],
      [
        { text: "Mind the road.", speaker: 0 },
        { text: "He hands you a letter.", speaker: 1 },
        { text: "Go.", speaker: 0 },
      ],
    ]);
    expect(parts.map((part) => part.references)).toEqual([[NPC], [NPC, NARRATOR]]);
  });

  it("renumbers a paragraph's voices from 0, so one spoken by the narrator alone is bare", () => {
    const parts = paragraphs({
      ...DIALOGUE,
      turns: [
        { text: "Take this.", speaker: 0 },
        { text: "\nHe hands you a letter.", speaker: 1 },
      ],
    });
    expect(parts[1]).toMatchObject({ turns: [{ text: "He hands you a letter.", speaker: 0 }], references: [NARRATOR] });
    expect(fishText(parts[1])).toBe("He hands you a letter.");
  });

  it("is left whole when there is no break", () => {
    expect(paragraphs(DIALOGUE)).toEqual([DIALOGUE]);
  });

  it("is spoken in turn and joined with the paragraph pause, billed for every part", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = decode(init.body as Uint8Array) as { text: string };
      calls.push(body.text);
      return stream([{ audio: `mp3:${body.text}` }]);
    }) as unknown as typeof globalThis.fetch;
    const stitch = vi.fn(async (parts: Buffer[], pause: number) =>
      Buffer.from(`${parts.map(String).join("|")}@${pause}`),
    );

    const result = await fishSpeech(BROKEN, { ...OPTIONS, fetchImpl, stitch });

    expect(calls).toEqual([
      "Take this to Ironforge.",
      "<|speaker:0|>Mind the road.<|speaker:1|>He hands you a letter.<|speaker:0|>Go.",
    ]);
    expect(result.ok && String(result.audio)).toBe(
      `mp3:${calls[0]}|mp3:${calls[1]}@${PARAGRAPH_PAUSE_SEC}`,
    );
    expect(result.ok && result.bytes).toBe(calls.reduce((n, text) => n + Buffer.byteLength(text), 0));
  });

  it("fails whole when any paragraph fails, and stitches nothing", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      n++ === 0
        ? audio()
        : new Response(JSON.stringify({ status: 500, message: "no" }), { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    const stitch = vi.fn();
    const result = await fishSpeech(BROKEN, { ...OPTIONS, fetchImpl, stitch });
    expect(result.ok || result.failure.kind).toBe("upstream");
    expect(stitch).not.toHaveBeenCalled();
  });

  it("fails as upstream when joining fails, rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => audio()) as unknown as typeof globalThis.fetch;
    const stitch = vi.fn(async () => {
      throw new Error("ffmpeg is not installed or not on PATH");
    });
    const result = await fishSpeech(BROKEN, { ...OPTIONS, fetchImpl, stitch });
    expect(result.ok || result.failure).toMatchObject({ kind: "upstream", message: expect.stringContaining("ffmpeg") });
  });
});

describe("the times fish.audio streams", () => {
  it("joins every chunk's audio in order", () => {
    const read = readTimedStream(sse([{ audio: "ID3a" }, { audio: "b" }, { audio: "c", seq: 1 }]));
    expect(read && String(read.audio)).toBe("ID3abc");
  });

  it("keeps each chunk's latest alignment, moved by the chunk's offset", () => {
    const read = readTimedStream(
      sse([
        { audio: "a", segments: [{ text: "Take", start: 0.06, end: 0.3 }] },
        {
          audio: "b",
          segments: [
            { text: "Take", start: 0.05, end: 0.3 },
            { text: "this.", start: 0.3, end: 0.6 },
          ],
          duration: 0.7,
        },
        { audio: "c", seq: 1, offset: 0.7, segments: [{ text: "Go.", start: 0.1, end: 0.4 }], duration: 0.5 },
      ]),
    );
    expect(read?.words).toEqual([
      { word: "Take", start: 0.05 },
      { word: "this.", start: 0.3 },
      { word: "Go.", start: expect.closeTo(0.8) },
    ]);
    expect(read?.durationSec).toBeCloseTo(1.2);
  });

  it("orders chunks by their sequence, not by when their alignment arrived", () => {
    const read = readTimedStream(
      sse([
        { audio: "a" },
        { audio: "b", seq: 1, offset: 1, segments: [{ text: "Go.", start: 0, end: 0.2 }] },
        { audio: "c", seq: 0, segments: [{ text: "Take", start: 0.1, end: 0.3 }] },
      ]),
    );
    expect(read?.words?.map((word) => word.word)).toEqual(["Take", "Go."]);
  });

  it("leaves out speaker tags and bracketed directions, which nothing shows", () => {
    const read = readTimedStream(
      sse([
        {
          audio: "a",
          segments: [
            { text: "<|speaker:0|>Take", start: 0, end: 0.2 },
            { text: "this.", start: 0.2, end: 0.4 },
            { text: "[sighs]", start: 0.4, end: 0.6 },
            { text: "<|speaker:1|>", start: 0.6, end: 0.6 },
            { text: "He", start: 0.7, end: 0.8 },
          ],
        },
      ]),
    );
    expect(read?.words?.map((word) => word.word)).toEqual(["Take", "this.", "He"]);
  });

  it("keeps no times when any chunk never got its alignment", () => {
    // Times for half the line would light the right words and then stop, or shift every
    // word after the gap.
    const read = readTimedStream(
      sse([
        { audio: "a", segments: [{ text: "Take", start: 0, end: 0.2 }] },
        { audio: "b", seq: 1, offset: 1 },
      ]),
    );
    expect(read?.words).toBeNull();
    expect(read && String(read.audio)).toBe("ab");
  });

  it("is null for a stream that is not fish.audio's events", () => {
    expect(readTimedStream("")).toBeNull();
    expect(readTimedStream("data: not json\n\n")).toBeNull();
    expect(readTimedStream(`data: ${JSON.stringify({ message: "queued" })}\n\n`)).toBeNull();
  });

  it("reads events split by CRLF, as SSE allows", () => {
    const read = readTimedStream(sse([{ audio: "a" }, { audio: "b" }]).replace(/\n/g, "\r\n"));
    expect(read && String(read.audio)).toBe("ab");
  });

  it("reaches the speaker's take as the line's word starts", async () => {
    const result = await fishSpeech(SOLO, { ...OPTIONS, fetchImpl: stub(audio()).fetchImpl });
    expect(result.ok && result.words).toEqual([{ word: "Hiccup", start: 0.1 }]);
  });

  it("moves each paragraph's times past the paragraphs and pauses before it", async () => {
    const BROKEN: FishSpeechRequest = {
      turns: [{ text: "Take this.\nGo.", speaker: 0 }],
      references: [NPC],
      settings: SETTINGS,
    };
    const answers = [
      stream([{ audio: "a", segments: [{ text: "Take", start: 0.06, end: 0.3 }, { text: "this.", start: 0.3, end: 0.8 }], duration: 1.5 }]),
      stream([{ audio: "b", segments: [{ text: "Go.", start: 0.06, end: 0.4 }], duration: 0.5 }]),
    ];
    const fetchImpl = vi.fn(async () => answers.shift()!) as unknown as typeof globalThis.fetch;
    const stitch = vi.fn(async (parts: Buffer[]) => Buffer.concat(parts));

    const result = await fishSpeech(BROKEN, { ...OPTIONS, fetchImpl, stitch });

    expect(result.ok && result.words).toEqual([
      { word: "Take", start: 0.06 },
      { word: "this.", start: 0.3 },
      { word: "Go.", start: expect.closeTo(1.5 + PARAGRAPH_PAUSE_SEC + 0.06) },
    ]);
  });

  it("keeps no times for a line any paragraph of which has none", async () => {
    const BROKEN: FishSpeechRequest = {
      turns: [{ text: "Take this.\nGo.", speaker: 0 }],
      references: [NPC],
      settings: SETTINGS,
    };
    const answers = [audio(), stream([{ audio: "b" }])];
    const fetchImpl = vi.fn(async () => answers.shift()!) as unknown as typeof globalThis.fetch;
    const stitch = vi.fn(async (parts: Buffer[]) => Buffer.concat(parts));

    const result = await fishSpeech(BROKEN, { ...OPTIONS, fetchImpl, stitch });

    expect(result.ok && result.words).toBeNull();
  });
});
