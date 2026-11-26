/** The link in the confirmation email: from now on the address hears when voices change. */
import { SITE } from "@/lib/site";
import { confirmFollow } from "@/lib/voice-feedback/follow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const confirmed = token !== "" && (await confirmFollow(token));
  return Response.redirect(`${SITE}/listen?${confirmed ? "followed=1" : "followed=0"}`, 303);
}
