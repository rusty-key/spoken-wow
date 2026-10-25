/** A Manager keeps a claim while its requests are in flight. `held: false` means drop it. */
import { holdJob } from "@/lib/worker/jobs";
import { workerUser } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await workerUser(request);
  if (!userId) return Response.json({ error: "not paired" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: unknown; attempt?: unknown };
  if (typeof body.jobId !== "string" || typeof body.attempt !== "number") {
    return Response.json({ error: "jobId and attempt are required" }, { status: 400 });
  }
  return Response.json({ held: await holdJob(userId, body.jobId, body.attempt) });
}
