/** Who a Manager's token belongs to, and which providers it generates for. */
import { db } from "@/lib/db";
import { readModes } from "@/lib/worker/mode";
import { workerUser } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await workerUser(request);
  if (!userId) return Response.json({ error: "not paired" }, { status: 401 });
  const { rows } = await db().query<{ name: string }>(`select "name" from "user" where "id" = $1`, [userId]);
  return Response.json({ name: rows[0]?.name ?? null, modes: await readModes(userId) });
}
