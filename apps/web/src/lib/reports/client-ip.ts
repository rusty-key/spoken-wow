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
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
