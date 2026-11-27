/** The link in the confirmation email: from now on the address hears when voices change. */
import { BASE_LANG, localeHref } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { SITE } from "@/lib/site";
import { confirmFollow } from "@/lib/voice-feedback/follow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const confirmed = token !== "" && (await confirmFollow(token));
  // Back to the page the player asked from; a language switched off since lands on English.
  const { lang } = await langParam(request);
  return Response.redirect(`${SITE}${localeHref(lang ?? BASE_LANG, "/listen")}?followed=${confirmed ? 1 : 0}`, 303);
}
