import { describe, expect, it } from "vitest";

import { decodeConnection, encodeConnection, parseConnection, serviceUrl } from "./voicestudio-connection";

describe("VoiceStudio connection", () => {
  it("fills the defaults and trims a /v1 base", () => {
    expect(parseConnection({ baseUrl: " https://voice.example.com/v1/ " })).toEqual({
      connection: { baseUrl: "https://voice.example.com", apiKey: "", model: "omnivoice", maxConcurrency: 1 },
      error: null,
    });
  });

  it("keeps a path prefix", () => {
    expect(serviceUrl("https://example.com/voicestudio/")).toEqual({
      url: "https://example.com/voicestudio",
      error: null,
    });
  });

  it.each([
    "http://voice.example.com",
    "https://localhost:3900",
    "https://api.localhost",
    "https://127.0.0.1",
    "https://10.0.0.5",
    "https://172.20.1.1",
    "https://192.168.1.10",
    "https://169.254.169.254",
    "https://100.101.102.103",
    "https://0.0.0.0",
    "https://[::1]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://[::ffff:127.0.0.1]",
    "https://user:pass@voice.example.com",
    "https://voice.example.com/?token=x",
    "not a url",
  ])("refuses %s", (baseUrl) => {
    expect(parseConnection({ baseUrl }).error).not.toBeNull();
  });

  it("accepts a public IP literal", () => {
    expect(serviceUrl("https://203.0.113.7:8443").error).toBeNull();
  });

  it.each([0, 9, 1.5, "two"])("refuses concurrency %s", (maxConcurrency) => {
    expect(parseConnection({ baseUrl: "https://voice.example.com", maxConcurrency }).error).toMatch(/concurrency/);
  });

  it("round-trips through the sealed form and re-checks it", () => {
    const { connection } = parseConnection({
      baseUrl: "https://voice.example.com",
      apiKey: "k",
      model: "omnivoice-large",
      maxConcurrency: "3",
    });
    expect(decodeConnection(encodeConnection(connection!))).toEqual(connection);
    expect(() =>
      decodeConnection(JSON.stringify({ ...connection, baseUrl: "https://127.0.0.1" })),
    ).toThrow(/invalid/);
    expect(() => decodeConnection("sk_not_json")).toThrow(/not readable/);
  });
});
