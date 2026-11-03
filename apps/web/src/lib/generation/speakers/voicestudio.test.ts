import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../dictionary", () => ({
  lexiconStamp: vi.fn(async () => "test-stamp"),
  readLexicon: vi.fn(async () => ({ entries: [{ grapheme: "Gnomeregan", alias: "nomeregan", confidence: "high" }] })),
}));
vi.mock("@/lib/voices/roster-store", () => ({
  loadRoster: vi.fn(async () => ({ voiceNames: ["dwarf-male-grim"] })),
}));
vi.mock("../stitch", () => ({
  stitchMp3: vi.fn(async (parts: Buffer[]) => Buffer.concat(parts)),
}));

const { checkVoiceStudio, voiceStudioSpeaker } = await import("./voicestudio");

function audio(): Response {
  return new Response(Buffer.from("ID3voice"), { headers: { "content-type": "audio/mpeg" } });
}

const MIB = 1024 * 1024;

/** A body that never ends, counting what was pulled from it and whether it was cancelled. */
function endless(contentType: string) {
  const seen = { chunks: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.chunks += 1;
      controller.enqueue(new Uint8Array(MIB));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { seen, response: new Response(body, { headers: { "content-type": contentType } }) };
}

const SERVICE = { baseUrl: "https://voice.test", apiKey: "", model: "omnivoice" };
const asFetch = (impl: unknown) => impl as typeof globalThis.fetch;
const speakTo = (fetchImpl: unknown, texts: string[]) =>
  voiceStudioSpeaker(SERVICE, asFetch(fetchImpl)).speak({
    turns: texts.map((text) => ({ text, voiceId: "profile-id" })),
    lang: "enUS",
    seed: null,
    dialogue: texts.length > 1,
  });

describe("VoiceStudio speaker", () => {
  it("stops reading audio that runs past the limit, and fails only that line", async () => {
    const { seen, response } = endless("audio/mpeg");
    const result = await speakTo(vi.fn(async () => response), ["Hello."]);

    expect(result).toMatchObject({ ok: false, failure: { kind: "upstream", fatal: false } });
    expect((result as { ok: false; failure: { message: string } }).failure.message).toMatch(/more than 16 MiB/);
    expect(seen.cancelled).toBe(true);
    expect(seen.chunks).toBeLessThan(20);
  });

  it("counts every turn of a line against the one limit", async () => {
    const turn = () =>
      new Response(new Uint8Array(10 * MIB), { headers: { "content-type": "audio/mpeg" } });
    const fetchImpl = vi.fn(async () => turn());

    const result = await speakTo(fetchImpl, ["One.", "Two."]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false, failure: { kind: "upstream" } });
  });

  it("keeps audio at exactly the limit", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array(16 * MIB), { headers: { "content-type": "audio/mpeg" } }),
    );
    expect((await speakTo(fetchImpl, ["Hello."])).ok).toBe(true);
  });

  it("reads only the start of an endless error or non-audio body", async () => {
    for (const make of [
      () => {
        const { seen, response } = endless("text/plain");
        return { seen, response: new Response(response.body, { status: 500 }) };
      },
      () => endless("text/html"),
    ]) {
      const { seen, response } = make();
      const result = await speakTo(vi.fn(async () => response), ["Hello."]);
      expect(result.ok).toBe(false);
      expect(seen.cancelled).toBe(true);
      expect(seen.chunks).toBeLessThan(20);
    }
  });

  it("refuses a voice list past the limit", async () => {
    const { seen, response } = endless("application/json");
    const voices = await voiceStudioSpeaker(SERVICE, asFetch(vi.fn(async () => response))).voices("enUS");

    expect(voices.ids.size).toBe(0);
    expect(voices.error).toMatch(/more than 1 MiB/);
    expect(seen.cancelled).toBe(true);
  });

  it("resolves locale-suffixed Spoken profile names to profile ids", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          voices: [
            { voice_id: "en-id", name: "dwarf-male-grim" },
            { voice_id: "es-id", name: "dwarf-male-grim@esMX" },
            { voice_id: "other", name: "alloy" },
          ],
        }),
      ),
    );

    const speaker = voiceStudioSpeaker(
      { baseUrl: "https://voice.test", apiKey: "", model: "omnivoice" },
      fetchImpl as unknown as typeof globalThis.fetch,
    );
    expect([...((await speaker.voices("esMX")).ids.entries())]).toEqual([
      ["dwarf-male-grim", "es-id"],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://voice.test/v1/audio/voices",
      expect.objectContaining({ headers: {}, redirect: "error" }),
    );
  });

  it("uses profile ids and the OpenAI-compatible speech endpoint", async () => {
    const fetchImpl = vi.fn(async () => audio());
    const speaker = voiceStudioSpeaker(
      { apiKey: "service-key", baseUrl: "https://voice.test", model: "omnivoice" },
      fetchImpl as unknown as typeof globalThis.fetch,
    );

    const result = await speaker.speak({
      turns: [{ text: "Hello.", voiceId: "profile-id", instructions: "[warm]" }],
      lang: "enUS",
      seed: null,
      dialogue: false,
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://voice.test/v1/audio/speech");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      Authorization: "Bearer service-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "omnivoice",
      voice: "profile-id",
      input: "Hello.",
      response_format: "mp3",
      instructions: "warm",
    });
  });

  it("applies the active locale lexicon before synthesis", async () => {
    const fetchImpl = vi.fn(async () => audio());
    const speaker = voiceStudioSpeaker(
      { baseUrl: "https://voice.test", apiKey: "", model: "omnivoice" },
      fetchImpl as unknown as typeof globalThis.fetch,
    );

    const result = await speaker.speak({
      turns: [{ text: "Gnomeregan está cerca.", voiceId: "profile-id" }],
      lang: "esMX",
      seed: null,
      dialogue: false,
    });

    expect(result).toMatchObject({ ok: true, made: { dictionaryId: null } });
    expect((result as { ok: true; made: { dictionaryVersion: string | null } }).made.dictionaryVersion).toMatch(
      /^voicestudio:/,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ input: "nomeregan está cerca." });
  });

  it("checks a connection by listing its voices, and says why one fails", async () => {
    const connection = { baseUrl: "https://voice.test", apiKey: "k", model: "omnivoice", maxConcurrency: 1 };
    const ok = vi.fn(async () => new Response(JSON.stringify({ voices: [] })));
    await checkVoiceStudio(connection, ok as unknown as typeof globalThis.fetch);
    expect(ok).toHaveBeenCalledWith(
      "https://voice.test/v1/audio/voices",
      expect.objectContaining({ headers: { Authorization: "Bearer k" } }),
    );

    const html = vi.fn(async () => new Response("<html>"));
    await expect(checkVoiceStudio(connection, html as unknown as typeof globalThis.fetch)).rejects.toThrow(
      /not one/,
    );
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkVoiceStudio(connection, down as unknown as typeof globalThis.fetch)).rejects.toThrow(
      /could not reach VoiceStudio/,
    );
  });
});
