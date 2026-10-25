/**
 * A Manager answers a claimed line with what the provider sent back for each request. The
 * line is generated from those answers and committed here. See lib/worker/jobs.ts.
 */
import type { RelayedAnswer } from "@/lib/generation/relay";
import { answerJob } from "@/lib/worker/jobs";
import { workerUser } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

function isAnswer(value: unknown): value is RelayedAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Record<string, unknown>;
  if (typeof answer.id !== "string") return false;
  if ("error" in answer) return typeof answer.error === "string";
  return (
    typeof answer.status === "number" &&
    typeof answer.body === "string" &&
    (answer.contentType === null || typeof answer.contentType === "string") &&
    (answer.characterCost === null || typeof answer.characterCost === "string")
  );
}

export async function POST(request: Request) {
  const userId = await workerUser(request);
  if (!userId) return Response.json({ error: "not paired" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: unknown; attempt?: unknown; answers?: unknown };
  if (
    typeof body.jobId !== "string" ||
    typeof body.attempt !== "number" ||
    !Array.isArray(body.answers) ||
    !body.answers.every(isAnswer)
  ) {
    return Response.json({ error: "jobId, attempt and answers are required" }, { status: 400 });
  }
  return Response.json(await answerJob(userId, { jobId: body.jobId, attempt: body.attempt, answers: body.answers }));
}
