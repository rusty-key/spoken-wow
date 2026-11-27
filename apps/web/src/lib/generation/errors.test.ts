import { describe, expect, it } from "vitest";

import { classifyUpstream, failure } from "./errors";
import { UPSTREAM_FAILED } from "@/lib/upstream-failed";

const WHAT = "generating the line";

/** The shape ElevenLabs uses for account-level refusals. */
function detail(status: string, message: string): string {
  return JSON.stringify({ detail: { status, message } });
}

describe("classifyUpstream", () => {
  // The distinction the whole batch loop turns on. Both are 401; only the slug tells them
  // apart, which is why the slug is matched before the status.
  it("separates running out of credits from a bad key, though both are 401", () => {
    const quota = classifyUpstream(
      401,
      detail("quota_exceeded", "You have 12 credits remaining, but 340 are required."),
      WHAT,
    );
    expect(quota.kind).toBe("quota");
    expect(quota.status).toBe(402);
    expect(quota.fatal).toBe(true);
    expect(quota.message).toContain("12 credits remaining");

    const auth = classifyUpstream(401, detail("invalid_api_key", "The key is invalid."), WHAT);
    expect(auth.kind).toBe("auth");
    expect(auth.fatal).toBe(true);
  });

  it("treats rate limiting as worth retrying, not worth stopping for", () => {
    for (const response of [
      classifyUpstream(429, "", WHAT),
      classifyUpstream(429, detail("too_many_concurrent_requests", "Slow down."), WHAT),
      classifyUpstream(503, detail("system_busy", "Try again."), WHAT),
    ]) {
      expect(response.kind).toBe("rate-limit");
      expect(response.status).toBe(429);
      expect(response.fatal).toBe(false);
    }
  });

  it("stops the batch when the voice is gone, because every line shares it", () => {
    const gone = classifyUpstream(404, detail("voice_not_found", "No such voice."), WHAT);
    expect(gone.kind).toBe("voice-missing");
    expect(gone.fatal).toBe(true);
  });

  it("fails one line and continues on a validation error", () => {
    const bad = classifyUpstream(
      422,
      JSON.stringify({ detail: [{ loc: ["body", "text"], msg: "text is too long" }] }),
      WHAT,
    );
    expect(bad.kind).toBe("bad-request");
    expect(bad.status).toBe(422);
    expect(bad.fatal).toBe(false);
    // The FastAPI validation array is unwrapped, or the message would be "[object Object]".
    expect(bad.message).toContain("text is too long");
  });

  it("joins several validation messages rather than showing only the first", () => {
    const bad = classifyUpstream(
      422,
      JSON.stringify({ detail: [{ msg: "too long" }, { msg: "bad model" }] }),
      WHAT,
    );
    expect(bad.message).toContain("too long");
    expect(bad.message).toContain("bad model");
  });

  it("reads a plain-string detail", () => {
    expect(classifyUpstream(401, JSON.stringify({ detail: "Unauthenticated" }), WHAT).message).toContain(
      "Unauthenticated",
    );
  });

  // The property that matters most: a body in a shape nobody anticipated must still produce
  // a usable failure rather than an exception that becomes an opaque 500.
  describe("bodies it does not recognise", () => {
    for (const [name, body] of [
      ["an HTML error page", "<html><body>502 Bad Gateway</body></html>"],
      ["empty", ""],
      ["a bare JSON string", '"nope"'],
      ["a JSON array", "[1,2,3]"],
      ["null", "null"],
      ["a detail that is a number", '{"detail":42}'],
      ["a detail array of non-objects", '{"detail":["a","b"]}'],
      ["a detail object with no status", '{"detail":{"message":"hm"}}'],
    ] as const) {
      it(`classifies ${name} without throwing`, () => {
        const result = classifyUpstream(500, body, WHAT);
        expect(result.kind).toBe("upstream");
        expect(result.fatal).toBe(false);
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      });
    }

    it("still uses the status when the body is unreadable", () => {
      expect(classifyUpstream(429, "<html>rate limited</html>", WHAT).kind).toBe("rate-limit");
      expect(classifyUpstream(401, "", WHAT).kind).toBe("auth");
    });
  });

  it("caps the upstream text rather than echoing an unbounded body", () => {
    const long = classifyUpstream(500, "x".repeat(5000), WHAT);
    expect(long.message.length).toBeLessThan(500);
  });

  // Whatever else is lost, the upstream text is not: it is the only thing distinguishing
  // "your plan does not allow this" from "that request was malformed".
  it("carries the upstream text through verbatim", () => {
    const result = classifyUpstream(
      400,
      detail("model_not_found", "eleven_v9 does not exist"),
      WHAT,
    );
    expect(result.message).toContain("eleven_v9 does not exist");
  });
});

describe("failure", () => {
  it("gives each kind a stable status and stop-or-continue verdict", () => {
    expect(failure("quota", "x")).toMatchObject({ status: 402, fatal: true });
    expect(failure("auth", "x")).toMatchObject({ status: UPSTREAM_FAILED, fatal: true });
    expect(failure("voice-missing", "x")).toMatchObject({ status: 409, fatal: true });
    expect(failure("rate-limit", "x")).toMatchObject({ status: 429, fatal: false });
    expect(failure("bad-request", "x")).toMatchObject({ status: 422, fatal: false });
    expect(failure("upstream", "x")).toMatchObject({ status: UPSTREAM_FAILED, fatal: false });
  });
});
