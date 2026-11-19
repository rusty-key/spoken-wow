/**
 * A team admin names the host the site sends requests to, so it must not be one of the droplet's
 * own neighbours: loopback, the private ranges, link-local (the cloud metadata service) or
 * carrier-grade NAT. Checked when a bucket is saved and before every connection test. A name that
 * resolves elsewhere later (DNS rebinding) is not caught; the requests are signed S3 calls, whose
 * answers are never shown beyond a status line.
 *
 * SPOKEN_STORAGE_ALLOW_PRIVATE=1 lifts it, for a MinIO on a developer's own machine.
 */
import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  PRIVATE.addSubnet(net, bits, "ipv6");
}

export class PrivateHostError extends Error {
  constructor(host: string) {
    super(`${host} is a private or local address; a team's bucket must be reachable on the internet`);
    this.name = "PrivateHostError";
  }
}

function isPrivate(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return PRIVATE.check(address, "ipv4");
  if (family === 6) {
    // An IPv4 address written as IPv6 is that IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? PRIVATE.check(mapped[1], "ipv4") : PRIVATE.check(address, "ipv6");
  }
  return true;
}

export async function assertPublicHost(url: string, resolve: typeof lookup = lookup): Promise<void> {
  if (process.env.SPOKEN_STORAGE_ALLOW_PRIVATE === "1") return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new PrivateHostError(host);
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivate(address))) throw new PrivateHostError(host);
}
