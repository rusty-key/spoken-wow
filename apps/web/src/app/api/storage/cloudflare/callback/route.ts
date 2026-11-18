/**
 * Where Cloudflare sends the admin back. The code is exchanged for an access token, which waits in
 * the sealed cookie, with whether it may make keys, while the Storage page asks which account and bucket. Every outcome goes back to
 * the Storage page, a refusal in `?cloudflare_error=`. Relative, so the redirect stays on the host
 * the browser used.
 */
import { requireCapability } from "@/lib/generation/authz";
import { currentSession } from "@/lib/session";
import { clearedCookie, CloudflareError, cookieFor, exchangeCode, pendingOf } from "@/lib/storage/cloudflare";

export const dynamic = "force-dynamic";

/** How long the grant waits for the admin to choose; Cloudflare's token may lapse sooner. */
const CHOOSE_MS = 15 * 60_000;

function back(lang: string | null, query: Record<string, string>, cookie: string): Response {
  const params = new URLSearchParams({ ...(lang ? { lang } : {}), ...query });
  return new Response(null, { status: 303, headers: { Location: `/admin/storage?${params}`, "Set-Cookie": cookie } });
}

export async function GET(request: Request) {
  const session = await currentSession();
  const pending = session ? pendingOf(request, session.user.id) : null;
  if (!session || pending?.step !== "authorize") {
    return back(null, { cloudflare_error: "The connection to Cloudflare lapsed or was started elsewhere: start it again." }, clearedCookie());
  }
  const { denied } = await requireCapability("admin", pending.lang);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const fail = (message: string) => back(pending.lang, { cloudflare_error: message }, clearedCookie());
  if (params.get("state") !== pending.state) return fail("Cloudflare's answer was not for this connection: start it again.");
  const refused = params.get("error");
  if (refused) {
    const why = params.get("error_description") ?? refused;
    return fail(`Cloudflare did not grant access: ${why.slice(0, 200)}`);
  }
  const code = params.get("code");
  if (!code) return fail("Cloudflare sent no code back: start again.");

  try {
    const { accessToken, expiresIn, mintsKeys } = await exchangeCode(code, pending.verifier);
    const until = Date.now() + Math.min(CHOOSE_MS, expiresIn * 1000);
    const cookie = cookieFor(session.user.id, { step: "connected", lang: pending.lang, token: accessToken, mintsKeys, until });
    return back(pending.lang, { cloudflare: "connected" }, cookie);
  } catch (error) {
    if (error instanceof CloudflareError) return fail(error.message);
    throw error;
  }
}
