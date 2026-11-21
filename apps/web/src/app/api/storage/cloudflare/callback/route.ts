/**
 * Where Cloudflare sends the admin back: the code becomes an access token in the sealed cookie, and
 * every outcome redirects (relatively) to the Storage page. Any page can link here, so only an answer
 * with this connection's state touches the cookie.
 */
import { requireCapability } from "@/lib/generation/authz";
import { currentSession } from "@/lib/session";
import { clearedCookie, CloudflareError, cookieFor, exchangeCode, pendingOf } from "@/lib/storage/cloudflare";

export const dynamic = "force-dynamic";

/** How long the grant waits for the admin to choose; Cloudflare's token may lapse sooner. */
const CHOOSE_MS = 15 * 60_000;

function back(lang: string | null, query: Record<string, string>, cookie: string | null): Response {
  const params = new URLSearchParams({ ...(lang ? { lang } : {}), ...query });
  const headers = new Headers({ Location: `/admin/storage?${params}` });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  const session = await currentSession();
  const pending = session ? pendingOf(request, session.user.id) : null;
  if (!session || pending?.step !== "authorize") {
    return back(null, { cloudflare_error: "The connection to Cloudflare lapsed or was started elsewhere: start it again." }, null);
  }
  const { denied } = await requireCapability("admin", pending.lang);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  if (params.get("state") !== pending.state) {
    return back(pending.lang, { cloudflare_error: "Cloudflare's answer was not for this connection: start it again." }, null);
  }
  const fail = (message: string) => back(pending.lang, { cloudflare_error: message }, clearedCookie());
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
