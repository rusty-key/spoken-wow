import { afterEach, describe, expect, it, vi } from "vitest";

import { BodyLimitError, memoryBlobs, r2Blobs, readBounded, s3Blobs } from "./store";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

const R2 = { accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "b", publicUrl: "https://p/" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("writing to R2", () => {
  it("never overwrites, and takes an object already under the key as written", async () => {
    const conditions: (string | null)[] = [];
    let body: unknown;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      body = init.body;
      conditions.push(new Headers(init.headers).get("if-none-match"));
      return new Response("PreconditionFailed", { status: 412 });
    });
    const bucket = r2Blobs(R2);
    await expect(bucket.put("recordings/x", Buffer.from("same bytes"), "audio/ogg")).resolves.toBeUndefined();
    expect(conditions).toEqual(["*"]);
    // Bytes, not a stream, so fetch sends the Content-Length R2 requires.
    expect(body).toBeInstanceOf(Uint8Array);
  });

  it("takes a locked object as written, and fails on any other conflict", async () => {
    let code = "ObjectLockedByBucketPolicy";
    vi.stubGlobal("fetch", async () => new Response(`<Error><Code>${code}</Code></Error>`, { status: 409 }));
    const bucket = r2Blobs(R2);
    await expect(bucket.put("takes/x", Buffer.from("same bytes"), "audio/mpeg")).resolves.toBeUndefined();
    code = "OperationAborted";
    await expect(bucket.put("takes/x", Buffer.from("same bytes"), "audio/mpeg")).rejects.toThrow("HTTP 409");
  });

  const putAnswering = (sent: typeof fetch) => {
    vi.stubGlobal("fetch", sent);
    return r2Blobs(R2).put("takes/x", Buffer.from("same bytes"), "audio/mpeg");
  };

  it("sends again after a connection failure and a 5xx", async () => {
    const sent = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(putAnswering(sent)).resolves.toBeUndefined();
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it("gives up after its last attempt with that attempt's failure", async () => {
    const sent = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(putAnswering(sent)).rejects.toThrow("fetch failed");
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it("does not send again when R2 refuses the request", async () => {
    const sent = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(putAnswering(sent)).rejects.toThrow("HTTP 403");
    expect(sent).toHaveBeenCalledOnce();
  });
});

describe("reading a range", () => {
  const text = async (body: ReadableStream<Uint8Array> | null) => (body ? new Response(body).text() : null);

  it("cuts the range from memory and reports the whole size and the stored type", async () => {
    const bucket = memoryBlobs();
    await bucket.put("takes/x", Buffer.from("0123456789"), "audio/ogg");
    const part = await bucket.get("takes/x", { suffix: 3 });
    expect(part).toMatchObject({ size: 10, contentType: "audio/ogg", range: { start: 7, end: 9 } });
    expect(await text(part!.body)).toBe("789");
    expect(await bucket.get("takes/x", { start: 10, end: null })).toMatchObject({ size: 10, body: null });
    expect(await bucket.get("takes/missing")).toBeNull();
  });

  it("asks R2 for the range only and reads the size from Content-Range", async () => {
    const asked: (string | null)[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      asked.push(new Headers(init.headers).get("range"));
      return new Response("01", {
        status: 206,
        headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-1/4096" },
      });
    });
    const bucket = r2Blobs(R2);
    const part = await bucket.get("takes/x", { start: 0, end: 1 });
    expect(asked).toEqual(["bytes=0-1"]);
    expect(part).toMatchObject({ size: 4096, contentType: "audio/mpeg", range: { start: 0, end: 1 } });
    expect(await text(part!.body)).toBe("01");
  });
});

describe("any S3-compatible bucket", () => {
  const S3 = {
    endpoint: "https://s3.eu-west-1.amazonaws.com",
    region: "eu-west-1",
    bucket: "team-audio",
    accessKeyId: "k",
    secretAccessKey: "s",
    publicUrl: null,
    pathStyle: false,
    conditionalPut: true,
  };

  it("addresses the bucket as a host when not path-style", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 404 });
    });
    expect(await s3Blobs(S3).head("takes/x")).toBeNull();
    expect(await s3Blobs({ ...S3, pathStyle: true }).get("takes/x")).toBeNull();
    expect(urls).toEqual([
      "https://team-audio.s3.eu-west-1.amazonaws.com/takes/x",
      "https://s3.eu-west-1.amazonaws.com/team-audio/takes/x",
    ]);
  });

  it("has no public address when private, and signs one that expires", async () => {
    const bucket = s3Blobs(S3);
    expect(bucket.url("takes/x")).toBeNull();
    const signed = new URL(await bucket.presign("takes/x", { method: "GET", expiresSec: 600 }));
    expect(signed.host).toBe("team-audio.s3.eu-west-1.amazonaws.com");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(signed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.searchParams.get("X-Amz-Credential")).toContain("/eu-west-1/s3/");
  });

  it("follows no redirect: a bucket's 3xx is a failure", async () => {
    const asked: (RequestRedirect | undefined)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      asked.push(init.redirect);
      return new Response(null, { status: 307, headers: { location: "http://169.254.169.254/" } });
    });
    await expect(s3Blobs(S3).get("takes/x")).rejects.toThrow("HTTP 307");
    expect(asked).toEqual(["manual"]);
  });

  it("looks before it writes where the provider ignores If-None-Match", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      return init.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-length": "4" } })
        : new Response(null, { status: 200 });
    });
    await s3Blobs({ ...S3, conditionalPut: false }).put("takes/x", Buffer.from("same"), "audio/mpeg");
    expect(methods).toEqual(["HEAD"]);
  });
});

describe("readBounded", () => {
  const trickle = (chunks: number, everyMs: number) =>
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunks-- <= 0) return controller.close();
        await new Promise((resolve) => setTimeout(resolve, everyMs));
        controller.enqueue(new Uint8Array(4));
      },
    });

  it("reads a body within its limits", async () => {
    expect((await readBounded(trickle(3, 0), { maxBytes: 100, deadlineMs: 1_000 })).byteLength).toBe(12);
  });

  it("refuses a body past its size, or keeps its start when truncating", async () => {
    await expect(readBounded(trickle(10, 0), { maxBytes: 10, deadlineMs: 1_000 })).rejects.toBeInstanceOf(BodyLimitError);
    expect((await readBounded(trickle(10, 0), { maxBytes: 10, deadlineMs: 1_000, truncate: true })).byteLength).toBe(10);
  });

  it("gives up on a body that trickles past its deadline", async () => {
    await expect(readBounded(trickle(100, 20), { maxBytes: 10_000, deadlineMs: 50 })).rejects.toThrow("no whole answer");
  });
});
