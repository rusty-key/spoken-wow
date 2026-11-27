export type Segment = { text: string; start: number; end: number };
export type StreamEvent = {
  audio: string;
  seq?: number;
  offset?: number;
  segments?: Segment[] | null;
  duration?: number;
};

/** fish.audio's with-timestamp answer: one SSE `message` per audio chunk. */
export function sse(events: StreamEvent[]): string {
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

export const stream = (events: StreamEvent[]) =>
  new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
