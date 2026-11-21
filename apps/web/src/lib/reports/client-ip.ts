/**
 * Which IP a request counts against for rate limiting.
 *
 * `x-real-ip` only, never `x-forwarded-for`. nginx overwrites the former
 * (deploy/web/nginx-spoken-api.conf) and appends to the latter, so a client that sends its own
 * X-Forwarded-For header lands in a fresh rate-limit bucket on every request - which is the
 * whole limit, defeated by one header. Nor `cf-connecting-ip` here: only nginx knows whether the
 * peer really was Cloudflare, and it resolves that into x-real-ip.
 *
 * When the header is missing, everyone shares the "unknown" bucket. That is the strict failure
 * on purpose: a misconfigured proxy should throttle, not wave everything through.
 */
export function clientIp(request: Request): string {
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.includes(":") ? ipv6Bucket(ip) : ip;
}

/** One subscriber holds a whole /64, so a bucket per address is a fresh limit per request. */
function ipv6Bucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0");
  const prefix = [...left, ...zeros, ...right].slice(0, 4).map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
