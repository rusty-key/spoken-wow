/**
 * What a route answers when a service it calls (ElevenLabs, Gemini, the mailer, CI) fails.
 * Never 502 or 504: Cloudflare replaces an origin's 502 or 504 body with its own error page,
 * so the route's message never reaches the browser.
 */
export const UPSTREAM_FAILED = 503;
