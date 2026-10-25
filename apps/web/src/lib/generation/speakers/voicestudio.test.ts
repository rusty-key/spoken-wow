import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/voices/slots", () => ({
  isVoiceSlot: vi.fn(async (name: string) => name === "dwarf-male-grim"),
}));
vi.mock("../stitch", () => ({
  stitchMp3: vi.fn(async (parts: Buffer[]) => Buffer.concat(parts)),
}));

const { voiceStudioSpeaker } = await import("./voicestudio");

function audio(): Response {
  return new Response(Buffer.from("ID3voice"), { headers: { "content-type": "audio/mpeg" } });
}

describe("VoiceStudio speaker", () => {
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

    const speaker = voiceStudioSpeaker({
      baseUrl: "http://voice.test",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });
    expect([...((await speaker.voices("esMX")).ids.entries())]).toEqual([
      ["dwarf-male-grim", "es-id"],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://voice.test/v1/audio/voices",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("uses profile ids and the OpenAI-compatible speech endpoint", async () => {
    const fetchImpl = vi.fn(async () => audio());
    const speaker = voiceStudioSpeaker({
      apiKey: "service-key",
      baseUrl: "http://voice.test",
      modelId: "omnivoice",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    const result = await speaker.speak({
      turns: [{ text: "Hello.", voiceId: "profile-id", instructions: "[warm]" }],
      lang: "enUS",
      seed: null,
      dialogue: false,
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://voice.test/v1/audio/speech");
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
});
