/** A worker gives a claimed line back unanswered, because it could not reach the provider. */
import { releaseJob } from "@/lib/worker/jobs";
import { workerUser } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await workerUser(request);
  if (!userId) return Response.json({ error: "not paired" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: unknown; attempt?: unknown };
  if (typeof body.jobId !== "string" || typeof body.attempt !== "number") {
    return Response.json({ error: "jobId and attempt are required" }, { status: 400 });
  }
  return Response.json({ released: await releaseJob(userId, body.jobId, body.attempt) });
}
