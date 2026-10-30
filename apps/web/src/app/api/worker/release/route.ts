/** A worker gives a claimed line back unanswered, because it could not reach the provider. */
import { releaseJob } from "@/lib/worker/jobs";
import { claimRoute } from "@/lib/worker/route";

export const dynamic = "force-dynamic";

export const POST = claimRoute("released", releaseJob);
