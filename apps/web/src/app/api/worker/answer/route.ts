/**
 * A Manager answers a claimed line with what the provider sent back for each request. The
 * line is generated from those answers and committed here.
 */
import { answerJob } from "@/lib/worker/jobs";
import type { RelayedAnswer } from "@/lib/worker/protocol";
import { isClaimRef, workerCall, type ClaimRef } from "@/lib/worker/route";

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

function isAnswered(body: Record<string, unknown>): body is ClaimRef & { answers: RelayedAnswer[] } {
  return Array.isArray(body.answers) && body.answers.every(isAnswer) && isClaimRef(body);
}

export async function POST(request: Request) {
  const call = await workerCall(request, { check: isAnswered, required: "jobId, attempt and answers are required" });
  if (call instanceof Response) return call;
  const { jobId, attempt, answers } = call.body;
  return Response.json(await answerJob(call.userId, { jobId, attempt, answers }));
}
