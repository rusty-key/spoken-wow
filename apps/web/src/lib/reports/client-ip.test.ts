import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

function request(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/reports", { headers });
}

describe("clientIp", () => {
  it("reads x-real-ip", () => {
    expect(clientIp(request({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("ignores x-forwarded-for entirely, since a client can send its own", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("unknown");
  });

  it("shares one bucket when the header is absent", () => {
    expect(clientIp(request({}))).toBe("unknown");
  });

  it("gives every address in an IPv6 /64 the same bucket", () => {
    const bucket = "2001:db8:1:2::/64";
    expect(clientIp(request({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }))).toBe(bucket);
    expect(clientIp(request({ "x-real-ip": "2001:db8:1:2::1" }))).toBe(bucket);
    expect(clientIp(request({ "x-real-ip": "2001:0DB8:0001:0002::9" }))).toBe(bucket);
  });

  it("keeps different /64s apart, however the address is compressed", () => {
    expect(clientIp(request({ "x-real-ip": "2001:db8:1:3::1" }))).toBe("2001:db8:1:3::/64");
    expect(clientIp(request({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientIp(request({ "x-real-ip": "::1" }))).toBe("0:0:0:0::/64");
  });

  it("reads an IPv4-mapped address as the IPv4 address", () => {
    expect(clientIp(request({ "x-real-ip": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
  });
});
