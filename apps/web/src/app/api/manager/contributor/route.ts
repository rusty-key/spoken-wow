import { viewerOf } from "@/lib/grants/store";
import { langsWhere } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Which languages the signed-in account administers, for the Manager to decide what to show. */
export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  return Response.json({
    email: session.user.email,
    adminLangs: langsWhere(await viewerOf(session), "admin"),
  });
}
