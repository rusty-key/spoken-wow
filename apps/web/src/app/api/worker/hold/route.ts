/** A Manager keeps a claim while its requests are in flight. `held: false` means drop it. */
import { holdJob } from "@/lib/worker/jobs";
import { claimRoute } from "@/lib/worker/route";

export const dynamic = "force-dynamic";

export const POST = claimRoute("held", holdJob);
