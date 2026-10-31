/**
 * A Manager claims its owner's queued lines, as the provider requests to send for each.
 * Only for providers its owner generates with on their own machine.
 */
import { isProvider } from "@/lib/generation/providers";
import { claimJobs } from "@/lib/worker/jobs";
import { readModes } from "@/lib/worker/mode";
import { workerCall } from "@/lib/worker/route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const call = await workerCall(request);
  if (call instanceof Response) return call;
  const { userId, body } = call;
  const modes = await readModes(userId);
  const providers = (Array.isArray(body.providers) ? body.providers : [])
    .filter(isProvider)
    .filter((provider) => modes[provider] === "local");
  if (providers.length === 0) return Response.json({ jobs: [] });

  const voices = Array.isArray(body.voices)
    ? body.voices
        .filter(
          (voice): voice is { name: string; voiceId: string } =>
            typeof voice?.name === "string" && typeof voice?.voiceId === "string",
        )
        .slice(0, 2_000)
    : null;
  const max = typeof body.max === "number" && Number.isFinite(body.max) ? body.max : 1;
  return Response.json({ jobs: await claimJobs(userId, { providers, max, voices }) });
}
