import "server-only";

import { workerUser } from "./tokens";

type Body = Record<string, unknown>;

/**
 * The worker and its request body, or the answer to give instead: 401 for nobody, 400 with
 * `required` for a body `valid` refuses.
 */
export async function workerCall<T extends Body = Body>(
  request: Request,
  valid?: { check: (body: Body) => body is T; required: string },
): Promise<{ userId: string; body: T } | Response> {
  const userId = await workerUser(request);
  if (!userId) return Response.json({ error: "not paired" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  if (valid && !valid.check(body)) return Response.json({ error: valid.required }, { status: 400 });
  return { userId, body: body as T };
}

export type ClaimRef = { jobId: string; attempt: number };

export function isClaimRef(body: Body): body is ClaimRef {
  return typeof body.jobId === "string" && typeof body.attempt === "number";
}

/** A route that acts on one claim and says whether it could, as `{ [said]: boolean }`. */
export function claimRoute(said: string, act: (owner: string, jobId: string, attempt: number) => Promise<boolean>) {
  return async (request: Request): Promise<Response> => {
    const call = await workerCall(request, { check: isClaimRef, required: "jobId and attempt are required" });
    if (call instanceof Response) return call;
    return Response.json({ [said]: await act(call.userId, call.body.jobId, call.body.attempt) });
  };
}
